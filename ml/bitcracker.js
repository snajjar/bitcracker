#!/usr/bin/env node

const utils = require('./utils');
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

const argv = yargs
    .command('fetch', 'Fetch data from a source')
    .command('extract', 'Extract and refine data from a specific granularity. If no arguments specified, extract for all granularities')
    .command('train', 'Train a model from a data souce')
    .command('predict', 'Predict next bitcoin values')
    .command('evolve', 'Evolve trader AIs to work on a market')
    .command('plot', 'Test a trader AIs on a market, and output a plottable .csv file')
    .option('interval', {
        alias: 'i',
        description: 'Set the time interval (in minutes). Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"',
        type: 'number',
    })
    .help()
    .demandCommand()
    .alias('help', 'h')
    .argv;

const main = async function() {
    if (argv.help) {
        process.exit(0);
    }

    var baseArgs = argv['_'];
    switch (baseArgs[0]) {
        case 'extract':
            const extract = require('./extract').extract;
            if (!baseArgs[1]) {
                // if unspecified interval, extract for every interval
                for (let i = 0; i < utils.intervals.length; i++) {
                    await extract(utils.intervals[i]);
                }
            } else {
                let interval = utils.strToInterval(baseArgs[1]);
                extract(interval);
            }
            break;
        case 'train':
            const train = require('./train').train;
            if (!baseArgs[1]) {
                console.error('You need to specify the data interval');
                process.exit(-1);
            } else {
                let interval = utils.strToInterval(baseArgs[1]);
                train(interval);
            }
            break;
        case 'predict':
            const predict = require('./predict').predict;
            if (!baseArgs[1]) {
                console.error('You need to specify the data interval');
                process.exit(-1);
            } else {
                let interval = utils.strToInterval(baseArgs[1]);
                predict(interval);
            }
            break;
        case 'evolve':
            const evolve = require('./neuroevolution').evolve;
            if (!baseArgs[1]) {
                console.error('You need to specify the data interval');
                process.exit(-1);
            } else {
                let interval = utils.strToInterval(baseArgs[1]);
                evolve(interval);
            }
            break;
        case 'plot':
            const plot = require('./plot').plot;
            if (!baseArgs[1]) {
                console.error('You need to specify the data interval');
                process.exit(-1);
            } else {
                let interval = utils.strToInterval(baseArgs[1]);
                plot(interval);
            }
            break;
        default:
            console.error(`${argv['_'][0]}: command not found`);
            break;
    }
}

main();