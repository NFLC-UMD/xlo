#!/usr/bin/env node

import * as fs from 'fs';
import { LoPackageExporter, XloStateEnum } from '../index';
const lpe: LoPackageExporter = new LoPackageExporter();

/* tslint:disable:rule1 no-var-requires */

const jsyml = require('js-yaml');
const prompts = require('prompts');
const rp = require('request-promise-native');
const chalk = require('chalk');
const clear = require('clear');
const figlet = require('figlet');
const path = require('path');
const program = require('commander');

// tslint:disable-next-line:no-console
const log = console.log;

program
  .version('0.0.1')
  .description("Download and package the current directory configuration.")
  .option('-f, --force', 'Remove/overwrite any objects already downloaded.')
  .parse(process.argv);


const state: XloStateEnum = lpe.checkDir();




if (state !== XloStateEnum.READYTOPACK) {
    log(chalk`
You must first run:

    {magenta xlo init}
`);

} else {
    if (program.force) {
      lpe.force = true;
    }
    lpe.setConfig();
    lpe.cliPack();
    
}

