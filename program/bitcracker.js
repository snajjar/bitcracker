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

yargs
    //.command('fetch', 'Fetch data from a source')
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
    .command('train <model> <interval>', 'Train a model from a data source', (yargs) => {
        yargs.positional('model', {
            description: 'name of the model',
            type: 'string',
        }).positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const train = require('./train');
        await train(argv.model, utils.strToInterval(argv.interval));
    })
    .command('predict <model> <interval>', 'Predict next bitcoin values', (yargs) => {
        yargs.positional('model', {
            describe: 'model to be used. "dense" or "denseVar"'
        }).positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const predict = require('./predict');
        await predict(argv.model, utils.strToInterval(argv.interval));
    })
    .command('evolve <interval>', 'Evolve trader AIs to work on a market', (yargs) => {
        yargs.positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const evolve = require('./evolve');
        await evolve(utils.strToInterval(argv.interval));
    })
    .command('plot <interval>', 'Output a plottable .csv file of a Trader results', (yargs) => {
        yargs.positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const plot = require('./plot');
        await plot(utils.strToInterval(argv.interval));
    })
    .command('evaluate <tradertype> <interval>', 'Evaluate a Trader on a data interval', (yargs) => {
        yargs.positional('tradertype', {
                describe: 'The trader type. Allowed:\n  - "ml" for machine learning, with option --model\n  - "algo" for algorithmic, with option --strategy'
            }).positional('interval', {
                describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
            }).option('model', {
                alias: 'm',
                description: 'path to a tensorflow model.json file',
                type: 'string',
            }).option('strategy', {
                alias: 's',
                description: 'name of an implemented strategy. Allowed value:\n  - EMAxSMA: trade long if EMA upcross SMA',
                type: 'string',
            }).option('start', {
                describe: 'optional start date YYYY-MM-DD',
                type: 'string',
            })
            .option('end', {
                describe: 'optional end date YYYY-MM-DD',
                type: 'string',
            })
    }, async (argv) => {
        if (argv.start) {
            config.setStartDate(argv.start);
        }
        if (argv.end) {
            config.setEndDate(argv.end);
        }

        const evaluate = require('./evaluate');
        let interval = utils.strToInterval(argv.interval);
        await evaluate(argv.tradertype, interval, { strategy: argv.strategy, model: argv.model });
    })
    .command('benchmark <interval>', 'Evaluate all traders on a data interval', (yargs) => {
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
        let interval = utils.strToInterval(argv.interval);
        await benchmark(interval);
    })
    .help()
    .demandCommand()
    .alias('help', 'h')
    .argv;