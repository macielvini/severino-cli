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
import {
  LocalCredentialsError,
  CredentialsIncompleteError,
  AuthFailedError,
  AuthRequestError,
  RegisterPointFailedError,
} from "./errors";

async function runConfig(): Promise<void> {
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
    throw new LocalCredentialsError();
  }

  if (!credentials.emp || !credentials.cpf) {
    throw new CredentialsIncompleteError();
  }

  const formData = new FormData();
  formData.append("emp", credentials.emp);
  formData.append("cpf", credentials.cpf);

  let response: Response;
  try {
    response = await fetch(
      "https://sistema.facilitaponto.com.br/registrar/auth",
      {
        method: "POST",
        body: formData,
      }
    );
  } catch (error) {
    throw new AuthRequestError({ cause: error });
  }

  if (!response.ok) {
    throw new AuthFailedError(undefined, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  const setCookieHeaders = response.headers.getSetCookie();
  const cookies = parseSetCookieHeaders(setCookieHeaders);
  await saveCookies(cookies);
  return cookies;
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
    throw new LocalCredentialsError();
  }

  if (!credentials.emp || !credentials.cpf) {
    throw new CredentialsIncompleteError();
  }

  const encodedEmployee = await getEncodedEmployee();

  const formData = new FormData();
  formData.append("mydata", "");
  formData.append("latitude", "");
  formData.append("longitude", "");
  formData.append("utmp", utmp);
  formData.append("registro", encodedEmployee);

  const cookieString = getCookieString(cookies);

  let response: Response;
  try {
    return;

    response = await fetch(
      "https://sistema.facilitaponto.com.br/registrar/grava",
      {
        method: "POST",
        headers: { Cookie: cookieString },
        body: formData,
      }
    );
  } catch (error) {
    throw new RegisterPointFailedError("Erro ao registrar ponto.", {
      cause: error,
    });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const cookieFile = path.join(getConfigDir(), "cookies.txt");
      try {
        await writeFile(cookieFile, "", { encoding: "utf8" });
      } catch {}

      cookies = await fetchAuthCookies(forceRefresh);
      const retryCookieString = getCookieString(cookies);

      let retryResponse: Response;
      try {
        retryResponse = await fetch(
          "https://sistema.facilitaponto.com.br/registrar/grava",
          {
            method: "POST",
            headers: { Cookie: retryCookieString },
            body: formData,
          }
        );
      } catch (error) {
        throw new RegisterPointFailedError("Erro ao registrar ponto.", {
          cause: error,
        });
      }

      if (!retryResponse.ok) {
        const text = await retryResponse.text();
        throw new RegisterPointFailedError("Erro ao registrar ponto.", {
          status: retryResponse.status,
          statusText: retryResponse.statusText,
          responseText: text,
        });
      }

      console.log("Ponto registrado com sucesso!");
      console.log(`Horário: ${utmp}`);
      return;
    }

    const text = await response.text();
    throw new RegisterPointFailedError("Erro ao registrar ponto.", {
      status: response.status,
      statusText: response.statusText,
      responseText: text,
    });
  }

  console.log("Ponto registrado com sucesso!");
  console.log(`Horário: ${utmp}`);
}

export async function pontoHandler(command: string | undefined) {
  switch (command) {
    case "config":
      await runConfig();
      break;
    default:
      await registerPoint();
  }
}
