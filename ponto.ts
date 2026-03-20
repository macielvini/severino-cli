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
  extractTimeEntriesFromHtml,
  type TimeRecord,
  formatTimeEntriesLog,
} from "./utils";
import {
  LocalCredentialsError,
  CredentialsIncompleteError,
  AuthFailedError,
  AuthRequestError,
  RegisterPointFailedError,
} from "./errors";
import { format, subDays } from "date-fns";

const BASE_URL = "https://sistema.facilitaponto.com.br";

const log = console.log;

async function runConfig(): Promise<void> {
  const existing = await loadAuthConfig();

  if (existing) {
    const cookies = await loadCookies();
    log("Credenciais atuais:");
    log(`  emp: ${existing.emp ?? ""}`);
    log(`  cpf: ${existing.cpf ?? ""}`);
    log(`  funcionario: ${existing.funcionario ?? ""}`);
    log(`Cookies de autenticação: \n${getCookieString(cookies)}`);

    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: "Deseja sobrescrever as credenciais existentes?",
      initial: false,
    });

    if (!overwrite) {
      log("Nenhuma alteração realizada.");
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
    log("Autenticação cancelada.");
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

  log(`Credenciais salvas em ${getAuthConfigPath()}`);
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
    response = await fetch(`${BASE_URL}/registrar/auth`, {
      method: "POST",
      body: formData,
    });
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
  log("Cookies de autenticação: \n" + getCookieString(cookies));
  await saveCookies(cookies);
  return cookies;
}

async function fetchEmployeeId(emp: string, cpf: string): Promise<string> {
  const formData = new FormData();
  formData.append("emp", emp);
  formData.append("cpf", cpf);

  const response = await fetch(`${BASE_URL}/registrar/auth`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `Falha ao obter registro: ${response.status} ${response.statusText}`
    );
  }
  const html = await response.text();

  const registro = extractRegistroFromHtml(html);
  return decodeEmployeeId(registro);
}

async function submitTimeEntry(): Promise<void> {
  const { ok } = await prompts({
    type: "confirm",
    name: "ok",
    message: "Pressione ENTER para continuar ou ESC para cancelar",
    initial: true,
  });
  if (!ok) return;

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
    response = await fetch(`${BASE_URL}/registrar/grava`, {
      method: "POST",
      headers: { Cookie: cookieString },
      body: formData,
    });
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
        retryResponse = await fetch(`${BASE_URL}/registrar/grava`, {
          method: "POST",
          headers: { Cookie: retryCookieString },
          body: formData,
        });
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

      log("Ponto registrado com sucesso!");
      log(`Horário: ${utmp}`);
      return;
    }

    const text = await response.text();
    throw new RegisterPointFailedError("Erro ao registrar ponto.", {
      status: response.status,
      statusText: response.statusText,
      responseText: text,
    });
  }

  log("Ponto registrado com sucesso!");
  log(`Horário: ${utmp}`);
}

async function getLastTimeEntries() {
  const credentials = await loadAuthConfig();
  if (!credentials?.cpf || !credentials?.emp) {
    throw new CredentialsIncompleteError();
  }

  const body = new FormData();
  body.append("usu", credentials.cpf);
  body.append("emp", credentials.emp);

  const authResponse = await fetch(`${BASE_URL}/portal/auth`, {
    method: "POST",
    body: body,
  });

  const authText = await authResponse.text();
  if (authText.toLowerCase() !== "ok") {
    throw new AuthFailedError(
      "Erro ao autenticar no portal Facilita Ponto. Verifique suas credenciais."
    );
  }

  const authCookies = parseSetCookieHeaders(
    authResponse.headers.getSetCookie()
  );

  const datePeriod = new FormData();
  datePeriod.append(
    "periodo_inicio",
    format(subDays(new Date(), 1), "dd/MM/yyyy")
  );
  datePeriod.append("periodo_fim", format(new Date(), "dd/MM/yyyy"));

  const registrosResponse = await fetch(`${BASE_URL}/portal/registros`, {
    method: "POST",
    headers: { Cookie: getCookieString(authCookies) },
    body: datePeriod,
  });

  const html = await registrosResponse.text();
  const timeEntries = await extractTimeEntriesFromHtml(html);
  const formattedTable = formatTimeEntriesLog(timeEntries);
  log(formattedTable);
}

export async function pontoHandler(command: string | undefined) {
  switch (command) {
    case "config":
      await runConfig();
      break;
    case "list":
      await getLastTimeEntries();
      break;
    default:
      await submitTimeEntry();
  }
}

