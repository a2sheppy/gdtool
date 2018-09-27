# gdtool
Tool for creating and working with MDN's `GroupData.json` file. Eventually I'd like this to have an assortment of commands to manage these files but for now it only has one feature: taking a specification, pulling out the WebIDL, and generating the `GroupData.json` formateed data for it.

## Installation

```
npm intall -g gdtool
```

## Usage
```
gdtool [options] <specification>
```
### Options:
* `-v`, `--version`: Outputs the version number of `gdtool`
* `-a <name>`, `--api-name <name>`: Specifies the name to give the API in the output JSON. This should correspond to the name of the specification
* `-c <mode>`, `--callback-mode <mode>`: Specifies how and if to include callbacks in the output. Possible values are `ignore` (don't include callbacks), `type` (include callbacks as members of the "types" list), or `callback` (include callbacks in a seaprate "callbacks" list)
* `-o <file>`, `--output-file <file>`: Sets the name of the file to create with the generated GroupData format content; if not specified, the output goes to `stdout`
* `-h`, `--help`: Outputs usage information

## Examples

```
gdtool localfile.webidl
```

This outputs to console the `GroupData.json` formatted JSON that represents the contents of the WebIDL found in `localfile.webidl`.

```
gdtool -a "WebRTC" -o webrtc.json -c type https://w3c.github.io/webrtc-pc/
```

Creates a file named `webrtc.json` containing the `GroupData.json` data for the WebRTC API, fetching the specification directly from the current editor's draft on the Web. The API name is set to "WebRTC", and callbacks are included among the `"types"` rather than having their own section.