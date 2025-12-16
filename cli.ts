import meow from "meow";

const cli = meow(
  `
Usage
  $ ponto <command>

Commands
  ponto auth    Configura autenticação
  ponto         Registra o ponto

Options
  --help, -h           Exibe esta mensagem
  --version, -v        Exibe a versão
  --update-cookies     Força atualização dos cookies de autenticação

Examples
  $ ponto auth
  $ ponto
  $ ponto --update-cookies
`,
  {
    importMeta: import.meta,
    autoVersion: true,
    autoHelp: true,
    flags: {
      updateCookies: {
        type: "boolean",
        default: false,
      },
    },
  }
);

export default cli;
