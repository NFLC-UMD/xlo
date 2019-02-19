import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

/* tslint:disable:rule1 no-var-requires */
const jsyml = require('js-yaml');
const chalk = require('chalk');
const prompts = require('prompts');
const axios = require('axios');
const makeDir = require('make-dir');
const semver = require('semver');
const { LogFrame } = require('log-frame');
const { Spinner } = require('logf-spinner');
const map = require('map-stream');
const vfs = require('vinyl-fs');

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

export interface IXloPackage {
  productType: string;
  filter: object;
}

export interface IXloYaml {
  host: string|null;
  user: string;
  package: IXloPackage;
}

export interface IFileInfo {
  container: string;
  name: string;
  size?: number;
  mtime?: string | Date;
}

export class LoPackageExporter {
  public force: boolean = false;
  private axi: any;
  private dataDirName: string = '__DATA__';
  private uiDirName: string = '__UI__';

  constructor(
    private config: IXloYaml = { host: null, user: '', package: {productType: '', filter: {}}},
    private packageDir: string = process.cwd(),
    private accessToken: string = '',
    private langs: any[] = [],
    private filterList: any[] = []
    ){
  
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
    log(chalk`Login to {magenta https://${this.config.host}} with user {magenta ${this.config.user}}.`);
    const r: any = await prompts({
      type: 'password',
      name: 'pwd',
      message: `Enter password`
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
    this.setAxiInstance(response.data.id);
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
    plist.push(makeDir(path.join(this.packageDir, this.dataDirName)));
    plist.push(makeDir(path.join(this.packageDir, this.uiDirName)));
    plist.push(makeDir(this.getLouiDirPath()));
    plist.push(makeDir(this.getPublicDirPath()));
    for (const LO of this.filterList) {
      plist.push(makeDir(this.getDataDir(runEnv, LO.containerId)));
    }
    await Promise.all(plist);

    // get UI files
    const datas = await this.getLatestUiFiles();
    await this.downloadUiFileGroup(datas[0]); // LOUI_v#-##
    await this.downloadUiFileGroup(datas[1]); // public container
    
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
      log(chalk`{green ${rs[0].statusText}} {blue ${rs[0].config.url}}`);   
      log(chalk`{green ${rs[1].statusText}} {blue ${rs[1].config.url}}`);   
      pees.push(rs);
    }
    await pees.reduce((accumulator, response) => accumulator.then(() => {
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
          // equiv of lodash _.uniq()
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
            log(`Skip ${chalk.cyan(fle[2])}`);
            return Promise.resolve();
          } else {
            return this.downloadFile(fle[0], fle[1], fle[2]);
          }  
        });
        downloads.push(p2);
      }
      return Promise.all(downloads);
    }), Promise.resolve());

    const indexHtmlPath = path.join(this.getLouiDirPath(), 'index.html');
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    if (indexHtml.indexOf('publicUpOne=true;')) {
      fs.writeFileSync(indexHtmlPath, indexHtml.replace('publicUpOne=true;', 'publicUpOne=false;'), 'utf8');
    }
    log('Copy UI files to each object directory.');
    await this.copyUIBuildIntoDirs(runEnv);
    log('Copy SCORM files to each object directory.');
    await this.addScormFiles(runEnv);

    return 'pack done';
  }
  private getUiRootDir(runEnv: XloRunEnv, containerId: string): string {
    // assuming SCORM package if not standalone
    return runEnv === XloRunEnv.STANDALONE ?
      this.packageDir :
      path.join(this.packageDir, this.dataDirName, containerId);
  }
  private getDataDir(runEnv: XloRunEnv, containerId: string): string {
    // assuming SCORM package if not standalone
    return runEnv === XloRunEnv.STANDALONE ?
      path.join(this.packageDir, 'data', containerId) :
      path.join(this.packageDir, this.dataDirName, containerId, 'data', containerId);
  }
  private short(p: string) {
    return p.replace(this.packageDir, '').replace(/\/([^/]+)$/, (a, b) => '/' + chalk.magenta(b));
  }

  private async fileExists(target: string): Promise<boolean> {
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

  private async downloadFile(containerId: string, dataPath: string, fileName: string) {
    const theUrl = this.getDataEndpoint(containerId, fileName);
    return this.axi.get(theUrl, {
      responseType:'stream'
    })
    .then( (response: any) => {
      const savePath = path.join(dataPath, fileName);
      const color = response.statusText === 'OK' ? 'green' : 'red';
      log(chalk`{${color} ${response.statusText}} ` + this.short(savePath));   
      return response.data.pipe(fs.createWriteStream(savePath));
    })
    .catch( (error: any) => {
      log('Download Error: ', error);
    });
  }

  private getDataEndpoint(containerId: string, fileName: string): string {
    if (/asset-[a-z\.]+$/.test(fileName)) {
      return `https://${this.config.host}/any/path/${fileName}`;
    } else {
      return `https://${this.config.host}/api/LearningObjectFC/${containerId}/download/${fileName}`;
    }
  }

  private setAxiInstance(accessToken: string) {
    this.axi = axios.create({
      httpsAgent: new https.Agent({  
        rejectUnauthorized: rejectSelfSignedCert
      }),
      headers: {
        'authorization': accessToken
      }
    });
  }

  /**
   * return [uiFiles, publicFiles]
   */
  private async getLatestUiFiles() {
    const response = await this.axi.get(`https://${this.config.host}/api/UI`);
    const uiContainerList: any[] = response.data;
    // get "LOUI_v#-#" containers
    const re: RegExp = /^LOUI_v(\d+)-(\d+)+$/;
    const LOUIs: IFileInfo[] = uiContainerList.filter(
      (c: IFileInfo) => {
        return re.test(c.name);
      });
    // get latest version "LOUI_v#-#"
    const versions: string[] = [];
    for (const loui of LOUIs) {
      const m: RegExpMatchArray | null = loui.name.match(re);
      if(m) {
        versions.push(m[1] + '.' + m[2] + '.0');
      }
    }
    let latest = semver.maxSatisfying(versions, '*');
    const tmp = latest.split('.');
    tmp.pop();
    latest = tmp.join('-');
    const latestCntr: IFileInfo | undefined = LOUIs.find(ui => ui.name === `LOUI_v${latest}`);
    if (!latestCntr) {
      throw new Error(`Cannot find "LOUI_v${latest}" in list with length: ${LOUIs.length}`);
    }
    const responses = await axios.all([
      this.axi.get(`https://${this.config.host}/api/UI/${latestCntr.name}/files`),
      this.axi.get(`https://${this.config.host}/api/UI/public/files`)
    ]);
    return [responses[0].data, responses[1].data];
  }

  private async downloadUiFileGroup(uiFileList: IFileInfo[]) {
    const pees: any[] = [];
    for (const file of uiFileList) {
      let savePath: string;
      if (file.container === 'public') {
        savePath = path.join(this.getPublicDirPath(), file.name);
      } else {
        savePath = path.join(this.getLouiDirPath(), file.name);
      }
      const exists = await this.fileExists(savePath);
      if (!exists || this.force) {
        const p = this.axi.get(`https://${this.config.host}/api/UI/${file.container}/download/${file.name}`, {
          responseType:'stream'
        })
        .then( (rs: any) => {
          const color = rs.statusText === 'OK' ? 'green' : 'red';
          log(chalk`{${color} ${rs.statusText}} ` + this.short(savePath));   
          return rs.data.pipe(fs.createWriteStream(savePath));
        })
        .catch( (error: any) => {
          log('Download Error: ', error);
        });
        pees.push(p);  
      } else {
        log(chalk`Skip {cyan ${file.name}}`);
      }
    }
    return pees.reduce((accumulator, response) => accumulator.then(response), Promise.resolve());
  }

  private async copyUIBuildIntoDirs(runEnv: XloRunEnv) {
    const pees: any[] = [];
    // log(chalk.magenta('Copy UI files to object directories.'));
    for (const LO of this.filterList) {
      const pathToUI = this.getUiRootDir(runEnv, LO.containerId);
      const exists = await this.fileExists(`${pathToUI}/index.html`);
      if (!exists || this.force) {
        pees.push(this.copyUiToPath(LO, pathToUI));
      }
    }
    return pees.reduce((accumulator, response) => accumulator.then(response), Promise.resolve());
  }

private async copyUiToPath(LO: any, pathToUI: string): Promise<any> {
    if(!LO.product) {
      throw new Error (LO.containerId + ": Could not identify product type");
    }
    if(!pathToUI) {
        throw new Error('pathToUI could not be found.');
    }

    const scriptFont: any = {
        'arabic': 'NotoNaskhArabicUI-*',
        'bengali': 'NotoSansBengaliUI-*',
        'burmese': 'NotoSansMyanmarUI-*',
        'devanagari': 'NotoSansDevanagariUI-*',
        'ethiopic': 'NotoSansEthiopic-*',
        // 'georgian': '', (none yet)
        'gujarati': 'NotoSansGujaratiUI-*',
        // 'gurmukhi': '', East Punjabi (none yet)
        'hanji': 'NotoSansTC-*',
        'hanji-jiantizi': 'NotoSansSC-*',
        'hebrew': 'NotoSansHebrew-*',
        'jiantizi': 'NotoSansSC-*',
        'kana': 'NotoSansCJKjp-*',
        'korean': 'NotoSansKR-*',
        // 'lao': '', (none yet)
        'nastaliq': 'NotoNastaliqUrdu-*',
        'tamil': 'NotoSansTamilUI-*',
        'thai': 'NotoSansThaiUI-*',
    };

    const base = this.getLouiDirPath();
    const gulpsrc = [
                    base + '/build-' + LO.product.toLowerCase() + '.js',
                    base + '/index.html',
                    base + '/public/fonts.css',
                    base + '/public/nflc-logo2.jpg',
                    base + '/public/MaterialIcons-Regular*',
                    base + '/public/videogular*',
                    base + '/public/NotoSansUI-*',
                    base + '/public/LICENSE*.txt'
                ];
    for (const script of LO.scripts) {
        if (scriptFont[script]) {
            gulpsrc.push(base + '/public/' + scriptFont[script]);
        }
    }

    if( LO.product.toUpperCase() === 'AO') {
        gulpsrc.push(base + '/public/nflc-logo2.png');
        gulpsrc.push(base + '/public/Pattern1.png');

        if (['LCR','LMC'].indexOf(`${LO.lessontype}`.toUpperCase()) !== -1){
            // Listening AO
            gulpsrc.push(base + '/public/beep.mp3');
            gulpsrc.push(base + '/public/kennedy.mp3');
            gulpsrc.push(base + '/public/littlebeep.mp3');
            gulpsrc.push(base + '/public/passage*.mp3');
        } else {
            gulpsrc.push('!/videogular*');
        }
    }
    return new Promise( (resolve, reject) => {
        return vfs.src(gulpsrc, { "base": base })
                // .pipe(map((f:any) => log(f.path)))
                .pipe(vfs.dest(pathToUI))
                .on('finish', resolve)
                .on('error', reject);            
    });
  }

  private async addScormFiles(runEnv: XloRunEnv): Promise<any> {
    let scormFiles: string;
    if (runEnv === XloRunEnv.SCORM2004) {
      scormFiles = `${__dirname}/scorm/2004/**`;
    } else if (runEnv === XloRunEnv.SCORM1P2) {
      scormFiles = `${__dirname}/scorm/1p2/**`;
    } else {
      return Promise.resolve();
    }
    const pees: any[] = [];
    for (const LO of this.filterList) {
      const pathToUI = this.getUiRootDir(runEnv, LO.containerId);
      const exists = await this.fileExists(`${pathToUI}/ims_xml.xsd`);
      if (!exists || this.force) {
        pees.push(() => {
          return new Promise((resolve, reject) => {
            return vfs.src(scormFiles)
            .pipe(vfs.dest(pathToUI))
            .on('finish', resolve)
            .on('error', reject);                  
          });
        });
      }
    }
    return pees.reduce((accumulator, response) => accumulator.then(response), Promise.resolve());
  }

  private async buildManifests(){
    log(chalk.magenta('Generate SCORM manifest file ...'));
    const pees: any[] = [];
    for (const LO of this.filterList) {
      const pathToUI = this.getUiRootDir(XloRunEnv.SCORM2004, LO.containerId);
      const exists = await this.fileExists(`${pathToUI}/imsmanifest.xml`);
      if (!exists || this.force) {
        pees.push(this.buildManifest(LO));
      }
    }
    return pees.reduce((accumulator, response) => accumulator.then(response), Promise.resolve());
  }

  private buildManifest(LO: any) {
    const dataDir = this.getDataDir(XloRunEnv.SCORM2004, LO.containerId);
    const contentJsonPath = path.join(dataDir, 'content.json');
    const contentJson: any = require(contentJsonPath);
    const BASE_URL = `https://${this.config.host}/`;

    const product = this.config.package.productType.toLowerCase();
    let loModality = 'Mixed';
    if(product === 'ao'){
        const mapy: any = {
            RMC: 'Reading',
            RCR: 'Reading',
            LMC: 'Listening',
            LCR: 'Listening'
        };
        try{ loModality = mapy[contentJson.lessonType] || 'UNIDENTIFIED'; }
        catch(e){ log(chalk.red(e)); }
    } else if(product === 'vlo'){
        loModality = 'Video';
    } 
    
    var loLevel = 'UNDEFINED';
    try {
        loLevel = contentJson.sources[0].level;
    }
    catch(e){}

    var loLanguage = 'UNDEFINED';
    try {
        loLanguage = contentJson.sources[0].language;
    }
    catch(e){}

    var products = {
        ao: {
            name: 'Assessment Object',
            description: `This Assessment Object will help you assess your ${loModality.toLowerCase()} comprehension in ${loLanguage}.  The passages and questions are appropriate for ILR Level ${loLevel}.`,
            learningresourcetype: 'Self Assesment'
        },
        vlo: {
            name: 'Video Learning Object',
            description: `This Video Learning Object will help you improve comprehension in ${loLanguage}.  The source material and activities are appropriate for ILR Level ${loLevel}.`,
            learningresourcetype: 'Exercise'                    
        },
        "dlo-clo": {
            name: 'Compact Learning Object',
            description: `This Compact Learning Object will help you improve comprehension in ${loLanguage}.  The source materials are appropriate for ILR Level ${loLevel}.`,
            learningresourcetype: 'Exercise'                    
        }
    }

    try {
        vlo.description = (contentJson.description || contentJson.sources[0].description);
    }
    catch(e){}

    var loProduct = {
        name: 'UNDEFINDED',
        description: 'UNDEFINED',
        learningresourcetype: 'UNDEFINED'                            
    }
    try {
        loProduct = products[product];
    }
    catch(e){}

    var loTopic = 'UNDEFINED';
    try {
        loTopic = contentJson.sources[0].topic;
    }
    catch(e){}

    var loDateInspected;
    try {
        loDateInspected = new Date(contentJson.dateInspected);
        if(loDateInspected == 'Invalid Date') throw 'Invalid Date';
    }
    catch(e){
        loDateInspected = new Date();
    }
    loDateInspected = loDateInspected.toISOString();
    loDateInspected = loDateInspected.substring(0,loDateInspected.indexOf('T'));

    var sourceInfo = [];
    try {
        for(let x=0;x<contentJson.sources.length;x++){
            let title = contentJson.sources[x].titleEnglish;
            let m = /<p>(.*?)<\/p>/g.exec(title);
            title = m ? m[1] : title;
            if(product === 'ao'){
                title = `Passage ${x+1}: ${title}`;
            } else if(product === 'dlo-clo') {
                title = `Day ${x+1}: ${title}`;                
            }
            sourceInfo.push({titleEnglish: title });
        }
    }
    catch(e){}

    var objectTitle = 'UNDEFINED';
    let regex = /(<([^>]+)>)/ig;
    try {
        if(contentJson.title){
            objectTitle = contentJson.title;
        } else {
            objectTitle = sourceInfo[0].titleEnglish;
        }
        objectTitle = objectTitle.replace(regex, "");
    }
    catch (e){}

    return new Promise(function(resolve,reject){
        return gulp.src(path.join(PACKAGE_DIR, LO.containerId, '**'))
            .pipe(manifest({
                version: CONFIG_JSON['scorm2004'] ? '2004': '1.2',
                courseId: contentJson.containerId,
                SCOtitle: 'AngularJS test',
                moduleTitle: 'AngularJS Test module',
                launchPage: `index.html?ui=${contentJson.product.toLowerCase()}&id=${contentJson.containerId}`,
                loMetadata: {
                    title: objectTitle,
                    product: loProduct,
                    modality: loModality,
                    contract: CONFIG_JSON.contract || 'UNDEFINED',
                    language: loLanguage,
                    topic: loTopic,
                    level: loLevel,
                    dateInspected: loDateInspected,
                    sources: sourceInfo
                },
                path: '',
                fileName: 'imsmanifest.xml'
            }))
            .pipe(gulp.dest(path.join(PACKAGE_DIR, LO.containerId)))
            .on('finish', resolve)
            .on('error', reject);            

    }); 
  }
  private getLouiDirPath(): string {
    return path.join(this.packageDir, this.uiDirName, 'loui');
  }
  private getPublicDirPath(): string {
    return path.join(this.getLouiDirPath(), 'public');
  }
}



export const lpe = LoPackageExporter;