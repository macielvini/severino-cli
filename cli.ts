import meow from "meow";

const cli = meow(
  `
Usage
  $ severino <command> [subcommand]

Commands
  severino ponto           Registra o ponto
  severino ponto config    Configura autenticação

Options
  --help, -h           Exibe esta mensagem
  --version, -v        Exibe a versão
  --update-cookies     Força atualização dos cookies de autenticação durante a execução do comando

Examples
  $ severino ponto config
  $ severino ponto
  $ severino ponto --update-cookies
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
