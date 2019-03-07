#!/usr/bin/env node

import { LoPackageExporter } from '../index';
const lpe: LoPackageExporter = new LoPackageExporter();

/* tslint:disable:rule1 no-var-requires */

const chalk = require('chalk');
const clear = require('clear');
const figlet = require('figlet');
const program = require('commander');
// tslint:disable-next-line:no-console
const log = console.log;

clear();
log(
  chalk.green(
    figlet.textSync('xlo-cli')
  )
);

program
  .version('0.0.1')
  .description("A tool for exporting and packaging AUTHOR Learning Objects. To get started, run " + chalk.bgWhite.magenta('xlo init') + " in an empty directory.")
  .command('init', 'Initialize an empty directory')
  .command('pack', 'Download and package the configured items for this directory.')
  .option('-o, --id [value]', 'Export object by id')
  .parse(process.argv);

