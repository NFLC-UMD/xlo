import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

/* tslint:disable:rule1 no-var-requires */
const jsyml = require('js-yaml');
const chalk = require('chalk');
const prompts = require('prompts');
const axios = require('axios');
const makeDir = require('make-dir');
// tslint:disable-next-line:no-console
const log = console.log;
const rejectSelfSignedCert = true;
// for axios
const agent = new https.Agent({  
  rejectUnauthorized: rejectSelfSignedCert
});

export enum XloStateEnum {
  NOCONFIG = 1,
  NOPACKAGE = 2,
  READYTOPACK = 3,
  PACKAGED = 4,
  INVALIDDIR = 5
}
export enum XloRunEnv {
  SCORM2004 = 1,
  SCORM1P2 = 2,
  STANDALONE = 3
}
export interface IXloYaml {
  host: string|null;
  user: string;
  package?: any;
}

export class LoPackageExporter {
  public force: boolean = false;
  private axi: any;

  constructor(
    private config: IXloYaml = { host: null, user: ''},
    private packageDir: string = process.cwd(),
    private accessToken: string = '',
    private langs: any[] = [],
    private filterList: any[] = []
    ){
      this.axi = axios.create({
        httpsAgent: new https.Agent({  
          rejectUnauthorized: rejectSelfSignedCert
        }),
        headers: {
          'authorization': this.accessToken
        }
      });
  
    }


  // cli only
  public checkDir(): XloStateEnum {
    const files = fs.readdirSync(process.cwd()); 
    if (files.find((v) => v === 'xlo-package.yml')) {
      try {
        this.config = jsyml.safeLoad(fs.readFileSync('xlo-package.yml', 'utf8'));
      } catch (e) {
        log(chalk.red('Could not read the xlo-package.yml file.  Please delete and re-initialize this directory.'));
        process.exit();
      }

      // validate for package definition
      if (!this.config.package && (this.config.host && this.config.user)) { 
        return XloStateEnum.NOPACKAGE;
      }
      else if (this.config.package && this.config.user) {
        return XloStateEnum.READYTOPACK;
      } else {
        return XloStateEnum.INVALIDDIR;
      }
    } else if (files.length === 0) {
      return XloStateEnum.NOCONFIG;
    } else {
      return XloStateEnum.INVALIDDIR;
    }
  }

  public setConfig() {
    this.config = jsyml.safeLoad(fs.readFileSync('xlo-package.yml', 'utf8'));
  }

  public async login() {
    const r: any = await prompts({
      type: 'password',
      name: 'pwd',
      message: `Enter password for user "${this.config.user}"`
    });
    const theBody: any = {
      username: this.config.user,
      password: r.pwd
    };
    if (this.config.user.indexOf('@') !== -1) {
      theBody.email = this.config.user;
      delete theBody.username;
    }
    const response = await axios({
      method: 'post',
      url: `https://${this.config.host}/api/users/login?rememberMe=false`,
      data: theBody,
      httpsAgent: agent
    });    
    return this.accessToken = response.data.id;
  }

  public async setLangs() {
    const response = await axios.get(`https://${this.config.host}/api/Langs`, {
      httpsAgent: agent
    });
    return this.langs = response.data;
  }

  public async setLearningObjectList() {
    const url = `https://${this.config.host}/api/LearningObjects/?access_token=${this.accessToken}&filter=` 
                + encodeURIComponent(JSON.stringify(this.config.package.filter));
    const response = await axios.get(url, {
      httpsAgent: agent
    });
    this.filterList = response.data;                
  }

  public async promptForRunEnv() {
    const r: any = await prompts({
      type: 'select',
      name: 'value',
      message: 'What will the run-time environment be for these objects?',
      choices: [
          { title: 'Scorm 2004', value: XloRunEnv.SCORM2004 },
          { title: 'Scorm 1.2', value: XloRunEnv.SCORM2004 },
          { title: 'Standalone', value: XloRunEnv.STANDALONE }
      ],
      initial: 0
    });
    return r.value;
  }

  public async cliPack() {
    await this.login();
    const runEnv = await this.promptForRunEnv();
    return this.pack(runEnv);
  }

  public async pack(runEnv: any) {
    await axios.all([this.setLangs(), this.setLearningObjectList()]);
    // create directory structure
    const plist: any[] = [];
    for (const LO of this.filterList) {
      plist.push(makeDir(this.getDataDir(runEnv, LO.containerId)));
    }
    await Promise.all(plist);
    // get data and file list endpoints
    const urlPair: any[] = [];
    for (const LO of this.filterList) {
      urlPair.push([
        `https://${this.config.host}/api/LearningObjectFC/${LO.containerId}/download/content.json`,
        `https://${this.config.host}/api/LearningObjects/${LO.containerId}/files`
      ]);  
    }
    log(chalk.magenta('Download content.json and all related object files ...'));
    const pees: any[] = [];
    for (const urls of urlPair) {
      const rs = await axios.all([
        this.axi.get(urls[0]),
        this.axi.get(urls[1])
      ]);
      log(chalk`{green ${rs[0].statusText}} {magenta ${rs[0].config.url}}`);   
      log(chalk`{green ${rs[1].statusText}} {magenta ${rs[1].config.url}}`);   
      pees.push(rs);
    }
    pees.reduce((accumulator, response) => accumulator.then(() => {
      const jso = response[0].data;
      const filelist = response[1].data;
      if(!jso.containerId) { // for legacy CLOs
        jso.containerId = jso.id;
      }
      log('Object #id: ', chalk.magenta(jso.containerId),' with #', chalk.magenta(filelist.length), 'files');
      const dataPath = this.getDataDir(runEnv, jso.containerId);
      const contentFilePath = path.join(dataPath, 'content.json');
      fs.writeFileSync(contentFilePath, JSON.stringify(jso), { encoding: 'utf8'});
      const x = this.filterList.findIndex((o) => o.containerId === jso.containerId);
      this.filterList[x].product = (jso.product || this.config.package.productType).toLowerCase();

      this.filterList[x].scripts = [];
      try {
          for (const src of jso.sources) {
              const lang = this.langs.find(o => o.iso === src.locale);
              if (lang) {
                  this.filterList[x].scripts.push(lang.script);
              }
          }
          this.filterList[x].scripts = [...new Set(this.filterList[x].scripts)];
      }
      catch(e) {
        log('error', e);
      }
      const re = /^[0-9a-zA-Z_.-]+$/;
      const p = [];
      for(const file of filelist) {
          if(file.name && re.test(file.name)) {
              if(file.name !== 'content.json') {
                  p.push([jso.containerId, dataPath, file.name]);
              }
          }
          else {
              if ('string' === typeof filelist) {
                  throw new Error(filelist);
              } else {
                  log(chalk.red("Invalid media file name: "+ file.name));
              }
          }
      }
  
      const downloads: any[] = [];
      for (const fle of p) {
        const target = path.join(fle[1], fle[2]);
        const p2: Promise<any> = this.fileExists(target).then( exists => { 
          if (exists && this.force === false) {
            log(`Skipping download: ${chalk.cyan(fle[2])}`);
            return Promise.resolve();
          } else {
            return this.downloadFile(fle[0], fle[1], fle[2]);
          }  
        });
        downloads.push(p2);
      }
      return Promise.all(downloads);
    }), Promise.resolve());
    return 'done';
  }

  private getDataDir(runEnv: XloRunEnv, containerId: string): string {
    return runEnv === XloRunEnv.STANDALONE ?
    path.join(this.packageDir, 'data', containerId) :
    path.join(this.packageDir, containerId, 'data', containerId);
  }

  private fileExists(target: string) {
    return new Promise((resolve, reject) => {
        fs.open(target, 'r', (err2, fd2) => {
            if (err2) {
              resolve(false);
            } else {
              resolve(true);
            }
        });                
    });      
  }

  private downloadFile(containerId: string, dataPath: string, fileName: string) {
    return this.axi.get({
      method: 'get',
      url: this.getDataEndpoint(containerId, fileName),
      responseType:'stream'
    })
    .then( (response: any) => {
      log("Downloaded:", chalk.blue(fileName));
      response.data.pipe(fs.createWriteStream(path.join(dataPath, fileName)));
    });
  }

  private getDataEndpoint(containerId: string, fileName: string) {
    if (/asset-[a-z\.]+$/.test(fileName)) {
      return `https://${this.config.host}/any/path/${fileName}`;
    } else {
      return `https://${this.config.host}/api/LearningObjectFC/${containerId}/download/${fileName}`;
    }
  }


}



export const lpe = LoPackageExporter;