#!/usr/bin/env node

const utils = require('./lib/utils');
const yargs = require('yargs');
const _ = require('lodash');
const fs = require('fs-extra');
var path = require('path');

const ensureRequiredDirs = function() {
    fs.ensureDirSync(path.join(path.resolve(__dirname), "data"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "supervised"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "neuroevolution"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "neuroevolution", "generation"));
}
ensureRequiredDirs();

yargs
    //.command('fetch', 'Fetch data from a source')
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
    .command('train <interval>', 'Train a model from a data source', (yargs) => {
        yargs.positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const train = require('./train');
        await train(utils.strToInterval(argv.interval));
    })
    .command('predict <interval>', 'Predict next bitcoin values', (yargs) => {
        yargs.positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const predict = require('./predict');
        await predict(utils.strToInterval(argv.interval));
    })
    .command('evolve <interval>', 'Evolve trader AIs to work on a market', (yargs) => {
        yargs.positional('interval', {
            describe: 'time interval for data: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"'
        })
    }, async (argv) => {
        const evolve = require('./neuroevolution');
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
        });
    }, async (argv) => {
        const evaluate = require('./evaluate');
        let interval = utils.strToInterval(argv.interval);
        await evaluate(argv.tradertype, interval, { strategy: argv.strategy });
    })
    .help()
    .demandCommand()
    .alias('help', 'h')
    .argv;