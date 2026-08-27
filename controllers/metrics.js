const prom_client = require('prom-client');
const _ = require('lodash')
const config = require("../utils/rconfig");

let promRegister = new prom_client.Registry();
let promAlertGauge = null;
let promAlertCounter = null;
let promOplogGauge = null;
let promOplogCounter = null;
let promCurrenOpGauge = null;
let promCurrenOpCounter = null;

let currentGauge =  null;
let currentOplogGauge =  null;
let currentOpGauge =  null;
let unfetchMetricsNum = 0;
const rateLimit = config().ratelimit;

const oplog_counter_init_label = process.env.OPLOG_INIT_LABEL ? JSON.parse(process.env.OPLOG_INIT_LABEL) : config().oplog.counterInitLabel;
const oplog_ignore_op =  process.env.OPLOG_IGNORE_OP ? JSON.parse(process.env.OPLOG_IGNORE_OP) : config().oplog.ignoreOp;
const oplog_ignore_field = process.env.OPLOG_IGNORE_FIELD ? JSON.parse(process.env.OPLOG_IGNORE_FIELD) : config().oplog.ignoreField;
const oplog_metrics_type = process.env.OPLOG_METRICS_TYPE || config().oplog.metricsType;
const oplog_metrics_name = process.env.OPLOG_METRICS_NAME || config().oplog.metricsName;
const oplog_value_length = process.env.OPLOG_VALUE_LENGTH || config().oplog.valueLength;

const currentop_counter_init_label = process.env.CURRENTOP_INIT_LABEL ? JSON.parse(process.env.CURRENTOP_INIT_LABEL) : config().currentOp.counterInitLabel;
const currentop_ignore_op =  process.env.CURRENTOP_IGNORE_OP ? JSON.parse(process.env.CURRENTOP_IGNORE_OP) : config().currentOp.ignoreOp;
const currentop_ignore_field = process.env.CURRENTOP_IGNORE_FIELD ? JSON.parse(process.env.CURRENTOP_IGNORE_FIELD) : config().currentOp.ignoreField;
const currentop_ignore_keyvalue = process.env.CURRENTOP_IGNORE_KEYVALUE ? JSON.parse(process.env.CURRENTOP_IGNORE_KEYVALUE) : config().currentOp.ignoreKeyValue;
const currentop_metrics_type = process.env.CURRENTOP_METRICS_TYPE || config().currentOp.metricsType;
const currentop_metrics_name = process.env.CURRENTOP_METRICS_NAME || config().currentOp.metricsName;
const currentop_value_length = process.env.CURRENTOP_VALUE_LENGTH || config().currentOp.valueLength;

exports.getMetrics = (req,res,next) =>{
    let tmpPromRegister = promRegister;
    promRegister = new prom_client.Registry();
    promAlertGauge = null;
    promOplogGauge = null;
    promCurrenOpGauge = null;
    currentGauge =  null;
    currentOplogGauge =  null;
    currentOpGauge =  null;
    unfetchMetricsNum = 0;

    res.setHeader('Content-Type', tmpPromRegister.contentType);
    tmpPromRegister.metrics()
        .then(function(result) {
            res.send(result)
        }, function(err) {
            res.statusCode(500).send(err);
        })
}

exports.postMetrics = (jsonLine) =>{
    let jsData = jsonLine

    let currentTimestamp = Math.floor(new Date().getTime() / 1000);
    if (jsData?.exporter_type == "oplog") {
        for (let i =0 ;i<oplog_ignore_field.length;i++){
            let field = oplog_ignore_field[i];
            delete jsData[field];
        }

        let metric_mode = oplog_metrics_type
        let metric_name = oplog_metrics_name
        let metric_value = oplog_metrics_type == "gauge" ? 1 : 1
        let metric_labels = jsData
        let oplog_type = jsData?.op

        let metricsValues = {}
        let labelKeyList = _.keys(metric_labels)
        for (let i=0;i <labelKeyList.length;i++){
            let labelKey = labelKeyList[i]
            let labelValue = ''
            if (labelKey == 'o') {
                if (JSON.stringify(metric_labels[labelKey]).length >= oplog_value_length ){
                    labelValue = JSON.stringify(metric_labels[labelKey]).replace(/{/g, '').replace(/}/g, '').replace(/"/g, '').replace(/$/g, '').replace(/\$/g, '').replace(/:/g, '_').replace(/\(/g, '_').replace(/\)/g, '_').substring(0, oplog_value_length);
                }else{
                    labelValue = JSON.stringify(metric_labels[labelKey]).replace(/{/g, '').replace(/}/g, '').replace(/"/g, '').replace(/$/g, '').replace(/\$/g, '').replace(/:/g, '_').replace(/\(/g, '_').replace(/\)/g, '_');
                }
            }else{
                labelValue = metric_labels[labelKey].toString().replace(/{/g, '').replace(/}/g, '').replace(/"/g, '').replace(/$/g, '').replace(/\$/g, '').replace(/:/g, '_').replace(/\(/g, '_').replace(/\)/g, '_');
            }

            metricsValues[labelKey] = labelValue
        }

        if (!oplog_ignore_op.includes(oplog_type)){
            if (metric_mode == "gauge") {
                if (promRegister.getSingleMetric(metric_name)) {
                    // console.log('Metric already exists');
                } else {
                    promOplogGauge = new prom_client.Gauge({
                        name: metric_name,
                        help: metric_name,
                        labelNames: [],
                        registers: [promRegister]
                    })
                    promRegister.registerMetric(promOplogGauge)
                    // console.log('Metric does not exist');
                }

                promOplogGauge.labelNames = _.keys(metricsValues)
                let metricsList = promRegister.getMetricsAsArray().length
                if (metricsList <= rateLimit ){
                    promOplogGauge.set(metricsValues,metric_value);
                }


            }else if (metric_mode == "counter"){
                if (promRegister.getSingleMetric(metric_name)) {
                    // console.log('Metric already exists');
                    promOplogCounter.inc(metricsValues);
                } else {
                    // promOplogGauge.labelNames = _.keys(metricsValues)
                    // console.log(111,metricsValues)
                    promOplogCounter = new prom_client.Counter({
                        name: metric_name,
                        help: metric_name,
                        labelNames: _.keys(metricsValues).concat(oplog_counter_init_label) ,
                        registers: [promRegister]
                    })
                    promRegister.registerMetric(promOplogCounter)
                    // console.log('Metric does not exist');
                }
                let metricsList = promRegister.getMetricsAsArray().length
                if (metricsList <= rateLimit ) {
                    promOplogCounter.inc(metricsValues);
                }
            }
        }
    }else if (jsData?.exporter_type == "currentOp") {
        let current_op_data_list = jsData?.inprog
        for (let i =0;i< current_op_data_list.length;i++){
            let current_op_data = current_op_data_list[i]
            let isContainCurrentOpIgnoreKeyValue = false
            for (let i =0 ;i < currentop_ignore_field.length;i++){
                let field = currentop_ignore_field[i];
                delete current_op_data[field];

                for (let i =0;i< currentop_ignore_keyvalue.length;i++){
                    let key = Object.keys(currentop_ignore_keyvalue[i])[0]
                    let value = currentop_ignore_keyvalue[i][key]
                    if (current_op_data.hasOwnProperty(key)) {
                        if (  typeof current_op_data[key] === 'object'){
                            isContainCurrentOpIgnoreKeyValue = JSON.stringify(current_op_data[key]).includes(value);
                        }else{
                            isContainCurrentOpIgnoreKeyValue = current_op_data[key].includes(value)
                        }
                        if (isContainCurrentOpIgnoreKeyValue){
                            break
                        }
                    }
                }
            }

            if (isContainCurrentOpIgnoreKeyValue){
                // console.log(4455,JSON.stringify(current_op_data))
                continue
            }
            // console.log(111,JSON.stringify(current_op_data))
            let metric_mode = currentop_metrics_type
            let metric_name = currentop_metrics_name
            let metric_value = currentop_metrics_type == "gauge" ? 1 : 1
            let metric_labels = current_op_data
            let currentop_type = current_op_data?.op

            let metricsValues = {}
            let labelKeyList = _.keys(metric_labels)

            for (let i=0;i <labelKeyList.length;i++){
                let labelKey = labelKeyList[i]
                let labelValue = ''
                if ( typeof metric_labels[labelKey] === 'object'){
                    if (JSON.stringify(metric_labels[labelKey]).length >= currentop_value_length ){
                        labelValue = JSON.stringify(metric_labels[labelKey]).replace(/{/g, '').replace(/}/g, '').replace(/"/g, '').replace(/$/g, '').replace(/\$/g, '').replace(/:/g, '_').replace(/\(/g, '_').replace(/\)/g, '_').substring(0, currentop_value_length);
                    }else{
                        labelValue = JSON.stringify(metric_labels[labelKey]).replace(/{/g, '').replace(/}/g, '').replace(/"/g, '').replace(/$/g, '').replace(/\$/g, '').replace(/:/g, '_').replace(/\(/g, '_').replace(/\)/g, '_');
                    }
                } else{
                    if (labelKey == "client") {
                        let clientip = metric_labels[labelKey].split(':')[0]
                        metricsValues['clientip'] = clientip
                    }
                    labelValue = metric_labels[labelKey].toString().replace(/{/g, '').replace(/}/g, '').replace(/"/g, '').replace(/$/g, '').replace(/\$/g, '').replace(/:/g, '_').replace(/\(/g, '_').replace(/\)/g, '_');
                }

                metricsValues[labelKey] = labelValue
            }

            if (!currentop_ignore_op.includes(currentop_type)){
                if (metric_mode == "gauge") {
                    if (promRegister.getSingleMetric(metric_name)) {
                    } else {
                        promCurrenOpGauge = new prom_client.Gauge({
                            name: metric_name,
                            help: metric_name,
                            labelNames: [],
                            registers: [promRegister]
                        })
                        promRegister.registerMetric(promCurrenOpGauge)
                        // console.log('Metric does not exist');
                    }

                    promCurrenOpGauge.labelNames = _.keys(metricsValues)
                    let metricsList = promRegister.getMetricsAsArray().length
                    if (metricsList <= rateLimit ){
                        promCurrenOpGauge.set(metricsValues,metric_value);
                    }


                }else if (metric_mode == "counter"){
                    if (promRegister.getSingleMetric(metric_name)) {
                        // console.log('Metric already exists');
                        promCurrenOpCounter.inc(metricsValues);
                    } else {
                        promCurrenOpCounter = new prom_client.Counter({
                            name: metric_name,
                            help: metric_name,
                            labelNames: _.keys(metricsValues).concat(currentop_counter_init_label) ,
                            registers: [promRegister]
                        })

                        promRegister.registerMetric(promCurrenOpCounter)
                        // console.log('Metric does not exist');
                    }
                    let metricsList = promRegister.getMetricsAsArray().length
                    if (metricsList <= rateLimit ) {
                        promCurrenOpCounter.inc(metricsValues);
                    }
                }
            }
        }
    }
}
