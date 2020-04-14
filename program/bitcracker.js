#!/usr/bin/env node

const utils = require('./lib/utils');
const yargs = require('yargs');
const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
var config = require('./config');

const ensureRequiredDirs = function() {
    fs.ensureDirSync(path.join(path.resolve(__dirname), "data"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "saved", "supervised"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "saved", "neuroevolution", "generation"));
}
ensureRequiredDirs();

var argv = yargs
    .command('fetch <pair> [source]', 'Fetch', (yargs) => {
        yargs.positional('pair', {
            describe: 'Pair of value you want to get data: ex BTCEUR',
            default: 'BTCEUR'
        }).positional('source', {
            describe: 'optional source for data',
            default: 'Cex',
        }).option('continue', {
            describe: 'start from last data you fetched on this pair, and continue from there',
            type: 'boolean',
        })
    }, async (argv) => {
        const fetch = require('./fetch');
        argv.pair = argv.pair.toUpperCase();
        await fetch(argv.pair, argv.source, argv.continue);
    })
    .command('extract [interval]', 'Extract and refine data from a specific granularity. If no arguments specified, extract for all granularities', (yargs) => {
        yargs.positional('interval', {
            describe: 'optional time interval: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const extract = require('./extract');
        if (!argv.interval) {
            // if unspecified interval, extract for every interval
            for (let i = 0; i < utils.intervals.length; i++) {
                await extract(utils.intervals[i]);
            }
        } else {
            await extract(utils.strToInterval(argv.interval));
        }
    })
    .command('train <model>', 'Train a model from a data source', (yargs) => {
        yargs.positional('model', {
            description: 'name of the model',
            type: 'string',
        }).option('break', {
            describe: 'optional date to separate train data and test data. format DD/MM/YYYY',
            type: 'string',
        })
    }, async (argv) => {
        const train = require('./train');
        await train(argv.model, argv.break);
    })
    .command('predict <model>', 'Predict next bitcoin values', (yargs) => {
        yargs.positional('model', {
            describe: 'model to be used. "dense" or "denseVar"'
        })
    }, async (argv) => {
        const predict = require('./predict');
        await predict(argv.model);
    })
    .command('evolve', 'Evolve trader AIs to work on a market', (yargs) => {}, async (argv) => {
        const evolve = require('./evolve');
        await evolve();
    })
    .command('plot', 'Output a plottable .csv file of a Trader results', (yargs) => {}, async (argv) => {
        const plot = require('./plot');
        await plot();
    })
    .command('evaluate <name>', 'Evaluate a Trader on a data interval', (yargs) => {
        yargs.positional('name', {
            describe: 'The trader name. Type "./bitcracker.js list traders" to have the complete list'
        })
    }, async (argv) => {
        const evaluate = require('./evaluate');
        await evaluate(argv.name);
    })
    .command('accuracy <name>', 'Evaluate a model accuracy on a price interval', (yargs) => {
        yargs.positional('model', {
            describe: 'The trader name. Type "./bitcracker.js list traders" to have the complete list'
        }).positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const accuracy = require('./accuracy');
        let interval = utils.strToInterval(argv.interval);
        await accuracy(argv.name, interval);
    })
    .command('benchmark', 'Evaluate all traders on a data interval', (yargs) => {
        yargs.option('stoploss', {
                describe: 'ratio for stoploss',
                type: 'number',
            })
            .option('takeprofit', {
                describe: 'ratio for takeprofit',
                type: 'number',
            })
            .option('start', {
                describe: 'optional start date YYYY-MM-DD',
                type: 'string',
            })
            .option('end', {
                describe: 'optional end date YYYY-MM-DD',
                type: 'string',
            })
    }, async (argv) => {
        if (argv.stoploss) {
            config.setStopLossRatio(argv.stoploss);
        }
        if (argv.takeprofit) {
            config.setTakeProfitRatio(argv.takeprofit);
        }
        if (argv.start) {
            config.setStartDate(argv.start);
        }
        if (argv.end) {
            config.setEndDate(argv.end);
        }

        const benchmark = require('./benchmark');
        await benchmark();
    })
    .help()
    .demandCommand()
    .alias('help', 'h')
    .option('interval', {
        describe: 'The data interval to use. Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d". Default to 1m',
        alias: 'i',
        type: 'string',
        default: '1m'
    })
    .option('start', {
        alias: 's',
        describe: 'optional start date YYYY-MM-DD',
        type: 'string',
    })
    .option('end', {
        alias: 'e',
        describe: 'optional end date YYYY-MM-DD',
        type: 'string',
    })
    .argv;

// handle interval settings globally
if (argv.start) {
    config.setStartDate(argv.start);
}
if (argv.end) {
    config.setEndDate(argv.end);
}
if (argv.interval) {
    let interval = utils.strToInterval(argv.interval);
    config.setInterval(interval);
}