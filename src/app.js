const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const execFile = require('child_process').execFile;
const assignJson = require('./polyfill/assign-json');


class Freemarker {
  constructor(options = {}) {
    this.tmpDir = os.tmpdir();
    this.sourceRoot = options.root || this.tmpDir;
    this.suffix = '.' + (options.suffix || 'ftl');
    this.tagSyntax = options.tagSyntax || 'angleBracket';
    this.cmd = path.join(path.resolve(__dirname, '..'),
      `fmpp/bin/fmpp${os.platform() === 'win32' ? '.bat' : ''}`);
  }

  get includes() {
    return  {
      patchSource(str) {
        return str.replace(/<#include "/g, `<#include "/@includes/`)
      },
      patchConfig(config, includesFolder) {
        return  Object.assign(config, {
          freemarkerLinks: `{
            includes: ${includesFolder.replace(/\\/g, "/")}
          }`
        })
      }
    };
  } 

  _randomFile() {
    return path.join(this.tmpDir, crypto.randomBytes(20).toString('hex'));
  }
  _writeConfig(configFile, config = {}) {
    let str = '';
    for (let key in config) {
      str += `${key}: ${config[key]}\n`;
    }
    fs.writeFileSync(configFile, str, 'utf8');
  }
  _writeData(tddFile, data = {}) {
    fs.writeFileSync(tddFile, JSON.stringify(data), 'utf8');
  }
  _writeFTL(ftlFile, str = '') {
    fs.writeFileSync(ftlFile, str, 'utf8');
  }
  _cleanFiles(files = []) {
    files.forEach(file => {
      fs.existsSync(file) && fs.unlinkSync(file);
    });
  }
  _getRealPath(file) {
    let _file = file;
    if (!_file.endsWith(this.suffix)) {
      _file += this.suffix;
    }
    if (!path.isAbsolute(_file)) {
      _file = path.join(this.sourceRoot, _file);
    }
    return _file;
  }

  render(str, data, callback, options) {
    if (options && options.includesFolder) str = this.includes.patchSource(str);
    const ftlFile = this._randomFile() + this.suffix;
    this._writeFTL(ftlFile, str);
    this.renderFile(ftlFile, data, (err, result) => {
      callback(err, result);
      this._cleanFiles([ftlFile]);
    }, options);
  }

  async renderFile(file, data = {}, callback = () => {}, options) {
    const _file = this._getRealPath(file);

    if (Object.entries(data).length === 0) {
      return this.renderProxy(_file, {}, callback, options);
    }

    let {tempPath, cleanFile, error, lines} = await assignJson.createTmp(_file, data, this.tagSyntax);
    if ( error ) {
      return callback(error);
    }
    this.renderProxy(tempPath, {}, (error, result) => {
      callback(error? error.replace(/line (\d+)\,/g, (match, line) => {
        return `line ${Number(line) - lines},`;
      }): error, result);
      cleanFile();
    }, options);

  }

  renderProxy(file, data, callback, options) {
    if (!file) return callback('No ftl file');
    const htmlFile = this._randomFile();
    const tddFile = this._randomFile();
    const configFile = this._randomFile();  
    const config = {
      sourceRoot: this.sourceRoot,
      tagSyntax: this.tagSyntax,
      outputFile: htmlFile,
      sourceEncoding: 'UTF-8',
      outputEncoding: 'UTF-8',
      data: `tdd(${tddFile})`,
    };
    
    if (options && options.includesFolder) {
      this.includes.patchConfig(config, options.includesFolder)
    }

    this._writeData(tddFile, data);
    this._writeConfig(configFile, config);

    execFile(this.cmd, [file, '-C', configFile], (err, log) => {
      let result = '';
      if (fs.existsSync(htmlFile)) {
        result = fs.readFileSync(htmlFile, 'utf8');
      }
      callback((err || !/DONE/.test(log)) ? log: null, result);
      this._cleanFiles([htmlFile, tddFile, configFile]);
    });
  }
};

module.exports = Freemarker;
