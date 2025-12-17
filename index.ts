#!/usr/bin/env bun

import cli from "./cli";
import { pontoHandler } from "./ponto";
import { handleCliError } from "./errors";

async function main() {
  const [command, subcommand] = cli.input;

  switch (command) {
    case "cara":
      console.log("Crachá! 🪪");
      break;
    case "ponto":
      await pontoHandler(subcommand);
      break;
    default:
      cli.showHelp();
  }
}

main().catch((err) => {
  handleCliError(err);
});
