"use strict";

class NflcLoPackager {

    constructor (targetDir, louiSrcDir) {
        this.targetDir = targetDir;
        this.louiSrcDir = louiSrcDir;
    }

    //getters and setters 
    
    //options object read from targetDir/lopkg.json
    set configOpts(options) {
        let opts = Object.assign({
                language: null,
                modality: null,
                product: null,
                lessonType: null,
                runTimeEnv: ""
            }, options);   
        this.apply(this, opts); //??
    }

    //methods

}

module.exports = NflcLoPackager; 