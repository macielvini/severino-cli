export type SeverinoErrorOptions = {
  exitCode?: number;
  isOperational?: boolean;
  cause?: unknown;
};

export class SeverinoError extends Error {
  exitCode: number;
  isOperational: boolean;

  constructor(message: string, options: SeverinoErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.exitCode = options.exitCode ?? 1;
    this.isOperational = options.isOperational ?? true;
  }
}

export class LocalCredentialsError extends SeverinoError {
  constructor(options: SeverinoErrorOptions = {}) {
    super(
      "Erro ao ler credenciais. Execute 'severino auth' primeiro.",
      options
    );
  }
}

export class CredentialsIncompleteError extends SeverinoError {
  constructor(options: SeverinoErrorOptions = {}) {
    super(
      "Credenciais incompletas. Execute 'severino auth' para configurar.",
      options
    );
  }
}

export class AuthFailedError extends SeverinoError {
  status?: number;
  statusText?: string;

  constructor(
    message: string = "Erro ao autenticar no Facilita Ponto. Verifique suas credenciais.",
    options: SeverinoErrorOptions & {
      status?: number;
      statusText?: string;
    } = {}
  ) {
    super(message, options);
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

export class AuthRequestError extends SeverinoError {
  constructor(options: SeverinoErrorOptions = {}) {
    super("Erro ao autenticar.", options);
  }
}

export class RegisterPointFailedError extends SeverinoError {
  status?: number;
  statusText?: string;
  responseText?: string;

  constructor(
    message: string = "Erro ao registrar ponto.",
    options: SeverinoErrorOptions & {
      status?: number;
      statusText?: string;
      responseText?: string;
    } = {}
  ) {
    super(message, options);
    this.status = options.status;
    this.statusText = options.statusText;
    this.responseText = options.responseText;
  }
}

export class CookieSaveError extends SeverinoError {
  constructor(options: SeverinoErrorOptions = {}) {
    super("Erro ao salvar cookies.", options);
  }
}

export class RegistroTokenNotFoundError extends SeverinoError {
  constructor(options: SeverinoErrorOptions = {}) {
    super("Token de registro não encontrado na resposta HTML.", options);
  }
}

export function handleCliError(err: unknown): never {
  if (err instanceof SeverinoError) {
    console.error(err.message);

    if (err instanceof AuthFailedError && err.status) {
      console.error(`Detalhes: ${err.status} ${err.statusText ?? ""}`.trim());
    }

    if (err instanceof RegisterPointFailedError) {
      if (err.status) {
        console.error(`Detalhes: ${err.status} ${err.statusText ?? ""}`.trim());
      }
      if (err.responseText) {
        console.error("Resposta:", err.responseText);
      }
    }

    if (!err.isOperational) {
      console.error(err);
    }

    process.exit(err.exitCode);
  }

  console.error("Erro inesperado:", err);
  process.exit(1);
}
