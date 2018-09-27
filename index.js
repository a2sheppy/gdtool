#!/usr/bin/env node

const WebIDL = require("webidl2");
const ExtractWebIDL = require("webidl-extract");

const program = require("commander");
const process = require("process");
const package = require("./package.json");
const fs = require("fs");
const endpoint = require("endpoint");
const http = require("http");
const https = require("https");

/* Callback handling modes */

const CALLBACKS_IGNORE = 0;
const CALLBACKS_LIST_AS_TYPES = 1;
const CALLBACKS_LIST_SEPARATELY = 2;

/* Configurable options; may make these command-line
   flags at some point */

var apiName;
var optionCallbackMode = CALLBACKS_LIST_SEPARATELY;
var sourcePath;
var outputFile = null;  // stdout; if not null, direct to file

var tabSize = 2;
var indentLevel = 4;

// Custom methods on Array to allow pushing only unique values

Array.prototype.pushIfUnique = function(item) {
  let matchFlag = false;

  this.forEach(function(listItem) {
    if (item.name == listItem.name) {
      matchFlag = true;
      return;
    }
  });

  if (!matchFlag) {
    this.push(item);
  }
};

function itemCompare(a, b) {
  return a.name.localeCompare(b.name);
}

/* Interpret command line options */

program
  .version(package.version, '-v, --version')
  .usage('[options] <specification>')
  .description('Scan the specified WebIDL file to generate GroupData.json output for a specification given by filename or URL')
  .option('-a, --api-name [name]', 'name of the API')
  .option('-c, --callback-mode [mode]', 'callback mode: ignore, type, or callback', /^(ignore|type|callback)$/i, 'callback')
  .option('-o, --output-file [file]', 'direct output to the specified file')
  .parse(process.argv);

if (!process.argv.slice(2).length) {
  program.help();
}

/* Get the source WebIDL path */

if (program.args.length) {
  sourcePath = program.args[0];
} else {
  console.error(program.name + ": No input file specified");
  return 1;
}
apiName = program.apiName || "API NAME HERE";
outputFile = program.outputFile || null;

// Select how to include callbacks

switch(program.callbackMode) {
  case "ignore":
    optionCallbackMode = CALLBACKS_IGNORE;
    break;
  case "type":
    optionCallbackMode = CALLBACKS_LIST_AS_TYPES;
    break;
  case "callback":
    optionCallbackMode = CALLBACKS_LIST_SEPARATELY;
    break;
  default:
    optionCallbackMode = CALLBACKS_LIST_SEPARATELY;
    break;
}

/* If the source path is a URL, we will need to
   fetch and pull the WebIDL from the linked spec */

if (sourcePath.startsWith("https://")) {
  getSpecIDL(sourcePath, function(err, sourceIDL) {
    if (err) {
      console.error(err);
      return;
    }

    idlToGroupData(sourceIDL);
  });
} else {
  fs.readFile(sourcePath, "utf8", (err, sourceIDL) => {
    if (err) {
      console.error(err);
      return;
    }

    idlToGroupData(sourceIDL);
  });
}

/* Parse the specified IDL and output it to either the
   command-line specified output file or to console */

function idlToGroupData(sourceIDL) {
  let tree = WebIDL.parse(sourceIDL);

  // Go through all the top-level entries and find the stuff
  // we need to add.

  let typeList = [];
  let interfaceList = [];
  let dictionaryList = [];
  let callbackList = [];

  tree.forEach(function(item) {
    let type = item.type;

    switch(type) {
      case "exception":
        console.error("Ignoring exception: " + item.name);
        break;
      case "serializer":
        console.error("Ignoring serializer: " + item.name);
        break;
      case "iterator":
        console.error("Ignoring iterator: " + item.name);
      break;
      case "interface mixin":
        console.error("Ignoring mixing: " + item.name);
        break;
      case "dictionary":
        dictionaryList.pushIfUnique(item);
        break;
      case "typedef":
      case "enum":
        typeList.pushIfUnique(item);
        break;
      case "interface":
        interfaceList.pushIfUnique(item);
        break;
      case "callback":
        switch (optionCallbackMode) {
          case CALLBACKS_IGNORE:
            break;
          case CALLBACKS_LIST_AS_TYPES:
            typeList.pushIfUnique(item);
            break;
          case CALLBACKS_LIST_SEPARATELY:
            callbackList.pushIfUnique(item);
            break;
          default:
            break;
        }
        break;
      case "eof":
        break;
      default:
        console.error("Unknown item type: " + item.idlType.idlType);
        break;
    }
  });

  typeList = typeList.sort(itemCompare);
  interfaceList = interfaceList.sort(itemCompare);
  dictionaryList = dictionaryList.sort(itemCompare);

  if (optionCallbackMode == CALLBACKS_LIST_SEPARATELY) {
    callbackList = callbackList.sort(itemCompare);
  }

  let output = generateGroupData(apiName, typeList, interfaceList, dictionaryList, callbackList);

  if (outputFile) {
    fs.writeFile(outputFile, output, function(err) {
      if (err) {
        console.error(err);
      }
    });
  } else {
    console.log(output);
  }
}

/* Actually generate the GroupData syntax from the set of items */

function generateGroupData(apiName, typeList, interfaceList, dictionaryList, callbackList) {
  let output = "";

  // First add the key and opening brace

  output = appendLine(output, `"${apiName}": {\n`);
  indentLevel++;

  // Section: Overview

  output = appendLine(output, `"overview":   [],\n`)

  // Section: Guides

  output = appendLine(output, '"guides":     [],\n')

  // Section: interfaces

  output += buildSection("interfaces", interfaceList);
  output += ",\n";

  // Section: dictionaries

  output += buildSection("dictionaries", dictionaryList);
  output += ",\n";

  // Section: types

  output += buildSection("types", typeList);
  output += ",\n";

  // Section: methods

  output = appendLine(output, `"methods":    [],\n`);

  // Section: properties

  output = appendLine(output, `"properties": [],\n`);

  // Section: events

  output = appendLine(output, `"events":     [],\n`);

  // Section: callbacks (if optionCallbackMode is CALLBACKS_LIST_SEPARATELY)

  if (optionCallbackMode == CALLBACKS_LIST_SEPARATELY) {
    output += buildSection("callbacks", callbackList);
    output += "\n";
  }

  // Finally, the closing brace

  indentLevel--;
  output = appendLine(output, "}\n");
  return output
}

function appendLine(str, line) {
  let output = " ".repeat(indentLevel * tabSize);

  output += line;
  str += output;
  return str;
}

function buildSection(sectionName, itemList) {
  let output = "";
  let count = itemList.length;
  let sectionNameLength = sectionName.length;

  // Generate space string to insert to align the first line properly

  let spaceCount = 11 - sectionNameLength;
  if (spaceCount < 1) {
    spaceCount = 1;
  }
  let firstLineSpaces = " ".repeat(spaceCount);
  let alignSpaces = " ".repeat(14);

  // If there are no items, deal with that case

  if (count === 0) {
    output = appendLine(output, `"${sectionName}":${firstLineSpaces}[]`);
    return output;
  }

  // Handle one item specially as well

  if (count === 1) {
    output = appendLine(output, `"${sectionName}":${firstLineSpaces}[ "${itemList[0].name}" ]`);
    return output;
  }
  output = appendLine(output, `"${sectionName}":${firstLineSpaces}[ "${itemList[0].name}",\n`);
  indentLevel++;

  for (let index = 1; index < count; index++) {
    let entry = "";

    entry += `${alignSpaces}"${itemList[index].name}"`;

    if (index < count-1) {
      entry += ',\n';
    } else {
      entry += ' ]'
    }
    output = appendLine(output, entry);
  }

  indentLevel--;
  return output;
}

/*
 * Load a spec from a URL, returning only the WebIDL contained within.
 *
 */
function getSpecIDL(specUrl, callback) {
  let titleRegexp = RegExp("<\s*title\s*>\s*(.*?)\s*<\s*\/\s*title>", "ig");

  https.get(specUrl, function(response) {
    response.pipe(new ExtractWebIDL())
            .pipe(endpoint(function(err, content) {
              if (err) {
                return callback(err);
              }
              callback(null, content.toString());
            }));
  });
}