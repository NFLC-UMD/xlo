#!/usr/bin/env node

import * as fs from 'fs';
import { IXloYaml, LoPackageExporter, XloStateEnum } from '../index';
const lpe: LoPackageExporter = new LoPackageExporter();

/* tslint:disable:rule1 no-var-requires */

const jsyml = require('js-yaml');
const prompts = require('prompts');
const rp = require('request-promise-native');
const chalk = require('chalk');
const program = require('commander');

// tslint:disable-next-line:no-console
const log = console.log;

program
  .version('0.0.1')
  .description("Initialize an empty directory.  This saves host, user, and package info into a file named xlo-package.yml")
  .option('-f, --force', 'Re-initialize the current directory and overwrite an existing xlo-package.yml file')
  .parse(process.argv);

async function GetBasicInfo() {
    const questions = [
        {
            initial: 'author.nflc.umd.edu',
            message: 'On which website is the package located?',
            name: 'host',
            type: 'text'
        },
        {
            message: 'Username or e-mail address?',
            name: 'user',
            type: 'text'
        },
        {
            message: 'Password?',
            name: 'pwd',
            type: 'password'
        }    
    ];
    return await prompts(questions);    
}

async function SelectPackage(responses: IXloYaml, pwd?: string): Promise<IXloYaml> {
    if (!pwd) {
        const r: any = await prompts({
            type: 'password',
            name: 'pwd',
            message: `Enter password for user "${responses.user}"`
        });
        pwd = r.pwd;
    }
    const theBody: any = {
        username: responses.user,
        password: pwd
    };
    if (responses.user.indexOf('@') !== -1) {
        theBody.email = responses.user;
        delete theBody.username;
    }
    return rp(`https://${responses.host}/api/users/login?rememberMe=false`, {
        json: true,
        strictSSL: false,
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: theBody  
    })
    .then((data: any) => {
        log(chalk`Got access token {yellow ${data.id}}`);
        const questions = [
            {
                choices: [
                    { title: 'Red', value: '#ff0000' },
                    { title: 'Green', value: '#00ff00' },
                    { title: 'Blue', value: '#0000ff' }
                ],
                message: 'Select a package',
                name: 'package',
                type: 'select'
            }
        ];
        return prompts(questions);
    })
    .then( (resp: any) => {
        responses.package = resp.package;
        return Promise.resolve(responses);
    });
}

const state: XloStateEnum = lpe.checkDir();
if (state === XloStateEnum.INVALIDDIR) {
    log(chalk`
The current directory is not empty. Get started by creating a new directory.

    {magenta mkdir /path/to/my-package}
    {magenta cd /path/to/my-package}
    {magenta xlo init}
`);
} else if (state === XloStateEnum.READYTOPACK) {
    const config: IXloYaml = jsyml.safeLoad(fs.readFileSync('xlo-package.yml', 'utf8'));
    log(chalk`
The current directory is already configured as follows:

{yellow ${jsyml.safeDump(config)}}

To download this package, type:

{magenta xlo pack}

Or, to re-initialize the current directory:

{magenta xlo init -f}
`);
} else {

    let pkgConfig: Promise<IXloYaml>;
    if (state === XloStateEnum.NOPACKAGE) {
        const config: IXloYaml = jsyml.safeLoad(fs.readFileSync('xlo-package.yml', 'utf8'));
        pkgConfig = SelectPackage(config);    
    } else {
        pkgConfig = GetBasicInfo()
        .then(responses => {
            const pwd: string = responses.pwd;
            // tslint:disable-next-line:no-string-literal
            delete responses['pwd'];
            fs.writeFileSync('xlo-package.yml', jsyml.safeDump(responses), 'utf8');
            return SelectPackage(responses, pwd);
        });    
    }
    pkgConfig.then( (config: IXloYaml) => {
        log(config);
    });    
}

