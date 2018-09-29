#!/usr/bin/env node

const WebIDL = require("webidl2");
//const ExtractWebIDL = require("webidl-extract");
const WebIDLFetchFromString = require("webidl-extract").WebIDLFetchFromString;
const program = require("commander");
const process = require("process");
const util = require("util");
const fs = require("fs");
const endpoint = require("endpoint");
const request = require("request-promise-native");
const package = require("./package.json");

/* Creats Promise-based version of fs.readFile */

const readFileAsync = util.promisify(fs.readFile);

/* Callback handling modes */

const CALLBACKS_IGNORE = 0;
const CALLBACKS_LIST_AS_TYPES = 1;
const CALLBACKS_LIST_SEPARATELY = 2;

/* Configurable options; may make these command-line
   flags at some point */

var apiName;
var optionCallbackMode = CALLBACKS_LIST_SEPARATELY;
var outputFile = null;  // stdout; if not null, direct to file

var tabSize = 2;
var indentLevel = 4;

// Handle unprocessed promise rejections, for debugging
// and other reasons

process.on("unhandledRejection", error => {
  console.error("OH NOES! " + error.message + ": ");
  console.dir(error);
});

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

/* Set up general command options */

program
  .version(package.version, '-v, --version')
  .usage('<command> [options] [command-options]')
  .description("Utility to generate and validate GroupData.json format data.")

/* Command: generate */

program
  .command("generate <specOrIDL...>")
  .alias("gen")
  .description('Scan the specified WebIDL file(s) and/or specification(s) to generate GroupData.json output for a specification given by filename or URL')
  .option('-a, --api-name [name]', 'name of the API')
  .option('-c, --callback-mode [mode]', 'callback mode: ignore, type, or callback', /^(ignore|type|callback)$/i, 'callback')
  .option('-o, --output-file [file]', 'direct output to the specified file')
  .action(doGenerateGroupData);

  /* Now run the command interpreter */

  program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.help();
}

/*
 * class APIDescription
 * 
 * Information about a class; currently just storage
 * for the item lists but eventually more will migrate
 * into this.
 */
class APIDescription {
  constructor() {
    this.typeList = [];
    this.interfaceList = [];
    this.dictionaryList = [];
    this.callbackList = [];
  }
}

var apiItemRecord = new APIDescription();

/* Process the specs and/or files and output the GroupData for all
   the IDL within them */

async function doGenerateGroupData(specList, program) {
  var idlList = [];     // A string with each input's IDL
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

  /* Iterate over the items in specList, fetching each
     spec and getting the IDL, building one large IDL
     buffer */

   await Promise.all(specList.map(async function(sourcePath) {
    try {
      idlList.push(await fetchIDL(sourcePath));
    } catch(err) {
      console.error(err);
    }
  }));

  /* Go through each IDL chunk and get the items inside */

  idlList.forEach(function(idl) {
    getItemsFromIDL(idl);
  });

  outputGroupData(buildGroupData(apiItemRecord));
}

/* Load one IDL file from either disk or URL */

async function fetchIDL(sourcePath) {
  let urlRegex = new RegExp("https?:\/\/.+", "ig");

  if (urlRegex.test(sourcePath)) {
    try {
      return await getRemoteIDL(sourcePath);
    } catch(err) {
      console.error(err);
      return '';
    }
  } else {
    return await getLocalIDL(sourcePath);
  }
}

/* Fetch an IDL file using a pathname, asynchronously */

async function getLocalIDL(sourcePath) {
  return await readFileAsync(sourcePath, "utf8");
}

/*
 * Load a spec from a URL, returning only the WebIDL contained within.
 *
 */
let titleRegexp = RegExp("<\s*title\s*>\s*(.*?)\s*<\s*\/\s*title>", "ig");
async function getRemoteIDL(specUrl) {
  let idl = '';
  
  idl = await request(specUrl).then(html => {
    return WebIDLFetchFromString(html);
  }).catch(function(err) {
    console.error(err);
  });

  return idl;
}

/* Given the text of an IDL file, add any top-level items
   within it to the item lists */

function getItemsFromIDL(sourceIDL) {
  let tree = WebIDL.parse(sourceIDL);

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
        apiItemRecord.dictionaryList.pushIfUnique(item);
        break;
      case "typedef":
      case "enum":
        apiItemRecord.typeList.pushIfUnique(item);
        break;
      case "interface":
        apiItemRecord.interfaceList.pushIfUnique(item);
        break;
      case "callback":
        switch (optionCallbackMode) {
          case CALLBACKS_IGNORE:
            break;
          case CALLBACKS_LIST_AS_TYPES:
            apiItemRecord.typeList.pushIfUnique(item);
            break;
          case CALLBACKS_LIST_SEPARATELY:
            apiItemRecord.callbackList.pushIfUnique(item);
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
}

/* Given the item lists, build the GroupData output */

function buildGroupData(apiData) {
  apiData.typeList = apiData.typeList.sort(itemCompare);
  apiData.interfaceList = apiData.interfaceList.sort(itemCompare);
  apiData.dictionaryList = apiData.dictionaryList.sort(itemCompare);

  if (optionCallbackMode == CALLBACKS_LIST_SEPARATELY) {
    apiData.callbackList = apiData.callbackList.sort(itemCompare);
  }

  return generateGroupData(apiData);
}

/* Output the GroupData to either console or the output file,
   if one was specified using --out-file */

function outputGroupData(output) {
  if (outputFile) {
    fs.writeFile(outputFile, output, function(err) {
      if (err) {
        console.error(err);
      }
    });
  } else {
    console.log(output);    // Dump to console
  }
}

/* Actually generate the GroupData syntax from the set of items */

function generateGroupData(apiData) {
  let output = "";

  // First add the key and opening brace

  output = appendLine(output, `"${apiName}": {\n`);
  indentLevel++;

  // Section: Overview

  output = appendLine(output, `"overview":   [],\n`)

  // Section: Guides

  output = appendLine(output, '"guides":     [],\n')

  // Section: interfaces

  output += buildSection("interfaces", apiData.interfaceList);
  output += ",\n";

  // Section: dictionaries

  output += buildSection("dictionaries", apiData.dictionaryList);
  output += ",\n";

  // Section: types

  output += buildSection("types", apiData.typeList);
  output += ",\n";

  // Section: methods

  output = appendLine(output, `"methods":    [],\n`);

  // Section: properties

  output = appendLine(output, `"properties": [],\n`);

  // Section: events

  output = appendLine(output, `"events":     [],\n`);

  // Section: callbacks (if optionCallbackMode is CALLBACKS_LIST_SEPARATELY)

  if (optionCallbackMode == CALLBACKS_LIST_SEPARATELY) {
    output += buildSection("callbacks", apiData.callbackList);
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
