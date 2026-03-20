import path from "node:path";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import {
  CookieSaveError,
  CredentialsIncompleteError,
  RegistroTokenNotFoundError,
} from "./errors";
import * as cheerio from "cheerio";
import chalk from "chalk";

export function getConfigDir(): string {
  return path.join(os.homedir(), ".config", "severino", "ponto");
}

export function getAuthConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export interface AuthConfig {
  emp?: string;
  cpf?: string;
  funcionario?: string;
}

export async function loadAuthConfig(): Promise<AuthConfig | null> {
  const configFile = getAuthConfigPath();
  try {
    return (await Bun.file(configFile).json()) as AuthConfig;
  } catch {
    return null;
  }
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  const configDir = getConfigDir();
  const configFile = getAuthConfigPath();
  await mkdir(configDir, { recursive: true });
  const payload = JSON.stringify(config);
  await Bun.write(configFile, payload);
}

export function parseSetCookieHeaders(
  setCookieHeaders: string[]
): Record<string, string> {
  const cookies: Record<string, string> = {};
  setCookieHeaders.forEach((cookieHeader) => {
    const parts = cookieHeader.split(";");
    if (parts.length === 0 || !parts[0]) return;
    const nameValue = parts[0];
    const nameValueParts = nameValue.split("=");
    if (nameValueParts.length < 2 || !nameValueParts[0]) return;
    const name = nameValueParts[0];
    const value = nameValueParts.slice(1).join("=");
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  return cookies;
}

export function getTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function getCookieString(cookies?: Record<string, string>): string {
  if (!cookies) {
    return "";
  }
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function parseCookieString(
  cookieString: string
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieString || !cookieString.trim()) return cookies;

  cookieString.split(";").forEach((pair) => {
    const trimmed = pair.trim();
    if (!trimmed) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return;
    const name = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (name && value) {
      cookies[name] = value;
    }
  });

  return cookies;
}

export async function loadCookies(): Promise<Record<string, string>> {
  const configDir = getConfigDir();
  const cookieFile = path.join(configDir, "cookies.txt");

  try {
    const content = await Bun.file(cookieFile).text();
    return parseCookieString(content.trim());
  } catch {
    return {};
  }
}

export async function saveCookies(
  cookies: Record<string, string>
): Promise<void> {
  const configDir = getConfigDir();
  const cookieFile = path.join(configDir, "cookies.txt");

  try {
    await mkdir(configDir, { recursive: true });
    const cookieString = getCookieString(cookies);
    await Bun.write(cookieFile, cookieString);
  } catch (error) {
    throw new CookieSaveError({ cause: error });
  }
}

export function extractRegistroFromHtml(html: string): string {
  const registroMatch = html.match(
    /<input[^>]+name=["']registro["'][^>]+value=["']([^"']+)["']/
  );
  if (registroMatch && registroMatch[1]) {
    return registroMatch[1];
  } else {
    throw new RegistroTokenNotFoundError();
  }
}

export function decodeEmployeeId(employeeId: string): string {
  const employeeDecoded = Buffer.from(employeeId, "base64").toString("utf8");
  const employeeJson = JSON.parse(employeeDecoded);
  return employeeJson.funcionario;
}

export async function getEncodedEmployee(): Promise<string> {
  const authConfig = await loadAuthConfig();
  if (!authConfig) {
    throw new CredentialsIncompleteError();
  }
  if (!authConfig.emp || !authConfig.cpf || !authConfig.funcionario) {
    throw new CredentialsIncompleteError();
  }
  return Buffer.from(
    JSON.stringify({
      data_hora: getTimestamp(),
      key: authConfig.emp,
      funcionario: authConfig.funcionario,
    }),
    "utf8"
  ).toString("base64");
}

export interface TimeRecord {
  date: string;
  time: string;
  type: string;
  status: string;
}

export async function extractTimeEntriesFromHtml(
  html: string
): Promise<TimeRecord[]> {
  const $ = cheerio.load(html);
  const records: TimeRecord[] = [];

  const dateHeaders: Array<{ date: string; h4: cheerio.Cheerio<any> }> = [];
  $("h4 strong").each((_, element) => {
    const dateElement = $(element);
    const date = dateElement.text().trim();

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      const h4Element = dateElement.closest("h4");
      dateHeaders.push({ date, h4: h4Element });
    }
  });

  const allPortlets = $(".portlet.light.bordered");

  allPortlets.each((_, portletElement) => {
    const portlet = $(portletElement);

    let associatedDate: string | null = null;

    const allElements = $("*");
    let portletFound = false;

    allElements.each((_, el) => {
      const current = $(el);

      if (current.is(portlet)) {
        portletFound = true;
        return false;
      }

      if (!portletFound && current.is("h4")) {
        const dateText = current.find("strong").text().trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) {
          associatedDate = dateText;
        }
      }
    });

    if (associatedDate) {
      const timeElement = portlet.find(".caption-subject.bold.uppercase");
      const time = timeElement.text().trim();

      const typeElement = portlet
        .find(".label-success, .label-danger, .label-warning, .label-info")
        .first();
      const type = typeElement.text().trim();

      const statusElement = portlet.find(".label-primary");
      const status = statusElement.text().trim();

      if (time && type) {
        records.push({
          date: associatedDate,
          time,
          type,
          status,
        });
      }
    }
  });

  return records;
}

export function formatTimeEntriesLog(timeEntries: TimeRecord[]): string {
  if (timeEntries.length === 0) {
    return "";
  }

  let maxDateWidth = 0;
  let maxTimeWidth = 0;
  let maxTypeWidth = 0;

  for (const entry of timeEntries) {
    maxDateWidth = Math.max(maxDateWidth, entry.date.length);
    maxTimeWidth = Math.max(maxTimeWidth, entry.time.length);
    maxTypeWidth = Math.max(maxTypeWidth, entry.type.length);
  }

  const rows: string[] = [];
  let lastEntry = timeEntries[0];
  for (const entry of timeEntries) {
    if (lastEntry && lastEntry.date !== entry.date) {
      rows.push("");
      lastEntry = entry;
    }

    const date = entry.date.padEnd(maxDateWidth);
    const time = chalk.bold(entry.time.padEnd(maxTimeWidth));

    let coloredType: string;
    const typeLower = entry.type.toLowerCase();
    if (typeLower.includes("entrada") || typeLower.includes("normal")) {
      coloredType = chalk.green(entry.type.padEnd(maxTypeWidth));
    } else if (typeLower.includes("saída") || typeLower.includes("saida")) {
      coloredType = chalk.red(entry.type.padEnd(maxTypeWidth));
    } else {
      coloredType = chalk.cyan(entry.type.padEnd(maxTypeWidth));
    }

    rows.push(`${date}  ${time}  ${coloredType}`);
  }

  return rows.join("\n");
}