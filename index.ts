#!/usr/bin/env bun

import cli from "./cli";
import prompts from "prompts";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getTimestamp,
  loadCookies,
  getCookieString,
  saveCookies,
  extractRegistroFromHtml,
  getAuthConfigPath,
  loadAuthConfig,
  saveAuthConfig,
  parseSetCookieHeaders,
  getConfigDir,
  decodeEmployeeId,
  getEncodedEmployee,
} from "./utils";

async function auth(): Promise<void> {
  const existing = await loadAuthConfig();

  if (existing) {
    console.log("Credenciais atuais:");
    console.log(`  emp: ${existing.emp ?? ""}`);
    console.log(`  cpf: ${existing.cpf ?? ""}`);
    console.log(`  funcionario: ${existing.funcionario ?? ""}`);

    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: "Deseja sobrescrever as credenciais existentes?",
      initial: false,
    });

    if (!overwrite) {
      console.log("Nenhuma alteração realizada.");
      return;
    }
  }

  const responses = await prompts([
    {
      type: "text",
      name: "emp",
      message: "Código da empresa (emp)",
      validate: (value: string) =>
        value && value.trim().length > 0 ? true : "Informe o código da empresa",
    },
    {
      type: "text",
      name: "cpf",
      message: "CPF",
      validate: (value: string) =>
        value && value.trim().length > 0 ? true : "Informe o CPF",
    },
  ]);

  if (!responses.emp || !responses.cpf) {
    console.log("Autenticação cancelada.");
    return;
  }

  const cpf = responses.cpf.trim().replace(/\D/g, "");
  const emp = responses.emp.trim();

  const employeeId = await fetchEmployeeId(emp, cpf);

  await saveAuthConfig({
    emp,
    cpf,
    funcionario: employeeId,
  });

  console.log(`Credenciais salvas em ${getAuthConfigPath()}`);
}

async function fetchAuthCookies(
  forceRefresh: boolean = false
): Promise<Record<string, string>> {
  if (!forceRefresh) {
    const savedCookies = await loadCookies();
    if (Object.keys(savedCookies).length > 0) {
      return savedCookies;
    }
  }

  const credentials = await loadAuthConfig();
  if (!credentials) {
    console.error("Erro ao ler credenciais. Execute 'ponto auth' primeiro.");
    process.exit(1);
  }

  if (!credentials.emp || !credentials.cpf) {
    console.error(
      "Credenciais incompletas. Execute 'ponto auth' para configurar."
    );
    process.exit(1);
  }

  const formData = new FormData();
  formData.append("emp", credentials.emp);
  formData.append("cpf", credentials.cpf);

  try {
    const response = await fetch(
      "https://sistema.facilitaponto.com.br/registrar/auth",
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      console.error(
        `Erro na autenticação: ${response.status} ${response.statusText}`
      );
      process.exit(1);
    }

    const setCookieHeaders = response.headers.getSetCookie();
    const cookies = parseSetCookieHeaders(setCookieHeaders);
    await saveCookies(cookies);
    return cookies;
  } catch (error) {
    console.error("Erro ao autenticar:", error);
    process.exit(1);
  }
}

async function fetchEmployeeId(emp: string, cpf: string): Promise<string> {
  const formData = new FormData();
  formData.append("emp", emp);
  formData.append("cpf", cpf);

  const response = await fetch(
    "https://sistema.facilitaponto.com.br/registrar/auth",
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(
      `Falha ao obter registro: ${response.status} ${response.statusText}`
    );
  }
  const html = await response.text();

  const registro = extractRegistroFromHtml(html);
  return decodeEmployeeId(registro);
}

async function registerPoint(): Promise<void> {
  const forceRefresh = cli.flags.updateCookies as boolean;
  let cookies = await fetchAuthCookies(forceRefresh);
  const utmp = getTimestamp();

  const credentials = await loadAuthConfig();
  if (!credentials) {
    console.error("Erro ao ler credenciais. Execute 'ponto auth' primeiro.");
    process.exit(1);
  }

  if (!credentials.emp || !credentials.cpf) {
    console.error(
      "Credenciais incompletas. Execute 'ponto auth' para configurar."
    );
    process.exit(1);
  }

  const encodedEmployee = await getEncodedEmployee();

  const formData = new FormData();
  formData.append("mydata", "");
  formData.append("latitude", "");
  formData.append("longitude", "");
  formData.append("utmp", utmp);
  formData.append("registro", encodedEmployee);

  try {
    const cookieString = getCookieString(cookies);

    const response = await fetch(
      "https://sistema.facilitaponto.com.br/registrar/grava",
      {
        method: "POST",
        headers: {
          Cookie: cookieString,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const cookieFile = path.join(getConfigDir(), "cookies.txt");
        try {
          await writeFile(cookieFile, "", { encoding: "utf8" });
        } catch {}
        cookies = await fetchAuthCookies(forceRefresh);
        const retryCookieString = getCookieString(cookies);
        const retryResponse = await fetch(
          "https://sistema.facilitaponto.com.br/registrar/grava",
          {
            method: "POST",
            headers: {
              Cookie: retryCookieString,
            },
            body: formData,
          }
        );
        if (!retryResponse.ok) {
          console.error(
            `Erro ao registrar ponto: ${retryResponse.status} ${retryResponse.statusText}`
          );
          const text = await retryResponse.text();
          console.error("Resposta:", text);
          process.exit(1);
        }
        console.log("Ponto registrado com sucesso!");
        console.log(`Horário: ${utmp}`);
        return;
      }
      console.error(
        `Erro ao registrar ponto: ${response.status} ${response.statusText}`
      );
      const text = await response.text();
      console.error("Resposta:", text);
      process.exit(1);
    }

    console.log("Ponto registrado com sucesso!");
    console.log(`Horário: ${utmp}`);
  } catch (error) {
    console.error("Erro ao registrar ponto:", error);
    process.exit(1);
  }
}

async function main() {
  const [command] = cli.input;

  switch (command) {
    case "auth":
      await auth();
      break;
    case "help":
      cli.showHelp();
      break;
    default:
      await registerPoint();
  }
}

main().catch((err) => {
  console.error("Erro ao executar o comando:", err);
  process.exit(1);
});
