const util = require('util')
const promisify = util.promisify
const fs = require('fs')
const path = require('path')
const {minify} = require('terser');
const {serialize} = require('serialize-to-js');

exports.readFile = promisify(fs.readFile)
exports.writeFile = promisify(fs.writeFile)
exports.stat = promisify(fs.stat)
exports.readdir = promisify(fs.readdir)
exports.unlink = promisify(fs.unlink)
exports.realpath = async function(path) {
  const realpath = promisify(fs.realpath)
  try {
    path = await realpath(path)
  } catch (e) {
    // do nothing
  }
  return path
}
exports.lstat = promisify(fs.lstat)
const fsExists = function(filename) {
  return new Promise(resolve => {
    fs.exists(filename, resolve)
  })
}
exports.exists = fsExists

const existsCache = new Map()
const resolve = async (filepath, filenames, root = path.parse(filepath).root) => {
  filepath = path.dirname(filepath)

  if (filepath === root || path.basename(filepath) === 'node_modules') {
    return null
  }

  for (const filename of filenames) {
    let file = path.join(filepath, filename)
    let exists = existsCache.has(file)
      ? existsCache.get(file)
      : await fsExists(file)
    if (exists) {
      existsCache.set(file, true)
      return file
    }
  }

  return resolve(filepath, filenames, root)
}
exports.resolve = resolve

function serializeObject(obj, shouldMinify = false) {
  let code = `module.exports = ${serialize(obj)};`

  if (shouldMinify) {
    let minified = minify(code)
    if (minified.error) {
      throw minified.error
    }

    code = minified.code
  }

  return code
}
module.exports = serializeObject
