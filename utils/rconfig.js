const fs = require("fs");
const path = require('path')


module.exports = (configPath) => {
    var  configdata = fs.readFileSync(path.join(__dirname,'../','config.json'))
    jdata =  JSON.parse(configdata)
    return jdata
}


