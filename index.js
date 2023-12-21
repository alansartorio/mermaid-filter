// #! /usr/bin/env node
var pandoc = require('pandoc-filter');
var _ = require('lodash');
var tmp = require('tmp');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').execSync;
var process = require('process')
var sanfile = require('sanitize-filename')
const utils = require('./lib')

var prefix = "diagram";
var cmd = utils.externalTool("mmdc", process.env);
var imgur = utils.externalTool("imgur", process.env);
var counter = 0;
var folder = process.cwd()
// Create a writeable stream to redirect stderr to file - if it logs to stdout, then pandoc hangs due to improper json.
// errorLog is used in pandoc.toJSONFilter
var tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'mermaid-filter-', postfix: '.err' });
var errorLog = fs.createWriteStream(tmpObj.name)

function mermaid(type, value, _format, _meta) {
    if (type != "CodeBlock") return null;
    var attrs = value[0],
        content = value[1];
    var id = attrs[0],
        classes = attrs[1];
    var options = {
        width: process.env.MERMAID_FILTER_WIDTH || 800,
        format: process.env.MERMAID_FILTER_FORMAT || 'png',
        loc: process.env.MERMAID_FILTER_LOC || 'inline',
        theme: process.env.MERMAID_FILTER_THEME || 'default',
        background: process.env.MERMAID_FILTER_BACKGROUND || 'white',
        caption: process.env.MERMAID_FILTER_CAPTION || '',
        filename: process.env.MERMAID_FILTER_FILENAME || '',
        scale: process.env.MERMAID_FILTER_SCALE || 1,
        imageClass: process.env.MERMAID_FILTER_IMAGE_CLASS || ''
    };
    var configFile = process.env.MERMAID_FILTER_MERMAID_CONFIG || path.join(folder, ".mermaid-config.json");
    var confFileOpts = ""
    if (fs.existsSync(configFile)) {
        confFileOpts += ` -c "${configFile}"`
    }
    var puppeteerConfig = process.env.MERMAID_FILTER_PUPPETEER_CONFIG || path.join(folder, ".puppeteer.json");
    var puppeteerOpts = ""
    if (fs.existsSync(puppeteerConfig)) {
        puppeteerOpts += ` -p "${puppeteerConfig}"`
    }
    var cssFile = process.env.MERMAID_FILTER_MERMAID_CSS || path.join(folder, ".mermaid.css");
    if (fs.existsSync(cssFile)) {
        confFileOpts += ` -C "${cssFile}"`
    }

    // console.log(classes)
    if (classes.indexOf('mermaid') < 0) return null;

    // console.log(attrs, content);
    attrs[2].map(item => {
        if (item.length  === 1) options[item[0]] = true;
        else options[item[0]] = item[1];
    });
    // console.log(options);
    // if (options.loc === 'inline') options.format = 'svg'
    counter++;
    //console.log(content);
    var tmpfileObj = tmp.fileSync();
    // console.log(tmpfileObj.name);
    fs.writeFileSync(tmpfileObj.name, content);
    var outdir = options.loc !== 'imgur' ? options.loc : path.dirname(tmpfileObj.name);
    // console.log(outdir);

    if (options.caption !== "" && options.filename === ""){
      options.filename = sanfile(options.caption, {replacement: ''}).replace(/[#$~%+;()\[\]{}&=_\-\s]/g, '');
    }

    if (options.filename === ""){
      options.filename = `${prefix}-${counter}`;
    }

    var savePath = tmpfileObj.name + "." + options.format
    var newPath = path.join(outdir, `${options.filename}.${options.format}`);
    var fullCmd = `${cmd}  ${confFileOpts} ${puppeteerOpts} -w ${options.width} -s ${options.scale} -f -i "${tmpfileObj.name}" -t ${options.theme} -b ${options.background} -o "${savePath}"`
    // console.log(fullCmd, savePath)
    exec(fullCmd);
    //console.log(oldPath, newPath);
    if (options.loc == 'inline') {
        if (options.format === 'svg') {
            var data = fs.readFileSync(savePath, 'utf8')
            newPath = "data:image/svg+xml;base64," + Buffer.from(data).toString('base64');
        } else if (options.format === 'pdf') {
            newPath = savePath
        } else  {
            var data = fs.readFileSync(savePath)
            newPath = 'data:image/png;base64,' + Buffer.from(data).toString('base64');
        }
    } else if (options.loc === 'imgur')
        newPath = exec(`${imgur} ${savePath}`)
            .toString()
            .trim()
            .replace("http://", "https://");
    else {
        mv(savePath, newPath);
    }

    var fig = "";

    if (options.caption != "") {
        fig = "fig:";
    }

    var imageClasses = options.imageClass ? [options.imageClass] : []

    return pandoc.Para(
        [
            pandoc.Image(
                [id, imageClasses, []],
                [pandoc.Str(options.caption)],
                [newPath, fig]
            )
    ]);
}

function mv(from, to) {
    var readStream = fs.createReadStream(from)
    var writeStream = fs.createWriteStream(to);

    readStream.on('close', () => {
        fs.unlinkSync(from);
    });
    readStream.pipe(writeStream);
}

pandoc.toJSONFilter(function(type, value, format, meta) {
    // Redirect stderr to a globally created writeable stream
    process.stderr.write = errorLog.write.bind(errorLog);
    return mermaid(type, value, format, meta);
});
