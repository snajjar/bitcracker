#!/usr/bin/env node

const utils = require('./lib/utils');
const yargs = require('yargs');
const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const config = require('./config');

const ensureRequiredDirs = function() {
    fs.ensureDirSync(path.join(path.resolve(__dirname), "data"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "saved", "supervised"));
    fs.ensureDirSync(path.join(path.resolve(__dirname), "models", "saved", "neuroevolution", "generation"));
}
ensureRequiredDirs();

var argv = yargs
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
    .option('assets', {
        alias: 'p',
        describe: 'Crypto assets to trade on (ex: BTC, ETH, BTH, XRP, ...)',
        type: 'string',
    })
    .option('currency', {
        alias: 'c',
        describe: 'main currency (ex: EUR, USD)',
        type: 'string',
    })
    .option('initialFund', {
        alias: 'f',
        describe: 'Initial fund (default: 1000€)',
        type: 'string',
    })
    .option('makerTax', {
        alias: 'm',
        describe: 'Maker tax (in %)',
        type: 'string',
    })
    .option('takerTax', {
        alias: 't',
        describe: 'Taker tax (in %)',
        type: 'string',
    })
    .middleware([setOptions])
    .command('fetch <asset> [currency] [source]', 'Fetch', (yargs) => {
        yargs.positional('asset', {
            describe: 'Crypto asset of the pair',
        }).positional('currency', {
            describe: 'Currency of the pair',
            default: 'EUR'
        }).positional('source', {
            describe: 'optional source for data',
            default: 'Cex',
        }).option('continue', {
            describe: 'start from last data you fetched on this pair, and continue from there',
            type: 'boolean',
        })
    }, async (argv) => {
        const fetch = require('./fetch');
        argv.asset = argv.asset.toUpperCase();
        argv.currency = argv.currency.toUpperCase();
        await fetch(argv.asset, argv.currency, argv.source, argv.continue);
    })
    .command('extract <asset> [currency] [interval]', 'Extract and refine data from a specific granularity. If no arguments specified, extract for all granularities', (yargs) => {
        yargs.positional('interval', {
            describe: 'optional time interval: Allowed: "1m", "5m", "15m", "30m", "1h", "4h", "1d", "7d", "15d"',
            default: "1m",
        }).positional('asset', {
            describe: 'Crypto asset of the pair',
        }).positional('currency', {
            describe: 'Currency of the pair',
            default: 'EUR'
        })
    }, async (argv) => {
        const extract = require('./extract');
        argv.asset = argv.asset.toUpperCase();
        argv.currency = argv.currency.toUpperCase();
        await extract(argv.asset, argv.currency, utils.strToInterval(argv.interval));
    })
    .command('train <model>', 'Train a model from a data source', (yargs) => {
        yargs.positional('model', {
            description: 'name of the model',
            type: 'string',
        }).option('break', {
            describe: 'optional date to separate train data and test data. format DD/MM/YYYY',
            type: 'string',
        }).option('lowmem', {
            describe: 'If possible, train in a low memory mode (slower)',
            type: 'boolean',
        });
    }, async (argv) => {
        const train = require('./train');
        await train({
            model: argv.model,
            break: argv.break,
            lowMemory: argv.lowmem
        });
    })
    .command('predict <model>', 'Predict next bitcoin values', (yargs) => {
        yargs.positional('model', {
            describe: 'model to be used. "dense" or "denseVar"'
        }).option('adjusted', {
            describe: 'Adjust each prediction according to the last errors',
            type: 'boolean',
        })
    }, async (argv) => {
        const predict = require('./predict');
        await predict(argv.model, argv.adjusted);
    })
    .command('evolve', 'Evolve trader AIs to work on a market', (yargs) => {}, async (argv) => {
        const evolve = require('./evolve');
        await evolve();
    })
    .command('plot', 'Output a plottable .csv file of a Trader results', (yargs) => {
        yargs.option('trader', {
            alias: 't',
            describe: 'The trader name. Type "./bitcracker.js list traders" to have the complete list',
            type: 'string',
        }).option('model', {
            alias: 'm',
            describe: 'The model name. Type "./bitcracker.js list models" to have the complete list',
            type: 'string',
        }).option('output', {
            describe: 'output file',
            alias: 'o',
            type: 'string',
        }).demandOption(['output'], 'Please provide output file for the plot command (-o output)')
    }, async (argv) => {
        const plot = require('./plot');
        if (argv.trader) {
            await plot("trader", argv.trader, argv.output);
        } else if (argv.model) {
            await plot("model", argv.model, argv.output);
        } else {
            console.error('You must choose either --trader or --model option');
        }
    })
    .command('evaluate <name> [resultInterval]', 'Evaluate a Trader.', (yargs) => {
        yargs.positional('name', {
            describe: 'The trader name. Type "./bitcracker.js list traders" to have the complete list'
        }).positional('resultInterval', {
            describe: 'Gather results for every [interval]. Examples: 5m 5h 5d 5w 5M 5Y',
        })
    }, async (argv) => {
        const evaluate = require('./evaluate');

        let duration = null;
        if (argv.resultInterval) {
            let n = parseInt(argv.resultInterval);
            let unit = argv.resultInterval.replace(n.toString(), '');
            duration = moment.duration(n, unit);
        }

        await evaluate(argv.name, duration);
    })
    .command('accuracy <name>', 'Evaluate a model accuracy on a price interval', (yargs) => {
        yargs.positional('model', {
            describe: 'The trader name. Type "./bitcracker.js list traders" to have the complete list'
        }).option('adjusted', {
            describe: 'Adjust each prediction according to the last errors',
            type: 'boolean',
        })
    }, async (argv) => {
        const accuracy = require('./accuracy');
        await accuracy(argv.name, argv.adjusted);
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
            .option('filter', {
                describe: 'filter all traders who contains the filter name in string',
                type: 'string',
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

        const benchmark = require('./benchmark');
        await benchmark(argv.filter);
    })
    .command('auth', 'Authenticate to Kraken. Required to trade', (yargs) => {}, async argv => {
        const auth = require('./auth');
        await auth();
    })
    .command('trade <name>', 'Trade with a trader. require Authentication.', (yargs) => {
        yargs.positional('name', {
            describe: 'The trader name. Type "./bitcracker.js list traders" to have the complete list'
        }).option('fake', {
            describe: "trade for fake. Doesn't require auth",
            type: "boolean",
            default: false,
        })
    }, async (argv) => {
        const trade = require('./trade');
        const fake = argv.fake == true;
        await trade(argv.name, fake);
    })
    .help()
    .demandCommand()
    .alias('help', 'h')
    .argv;

function setOptions(argv) {
    // handle interval settings globally
    if (argv.start) {
        config.setStartDate(argv.start);
    }
    if (argv.end) {
        config.setEndDate(argv.end);
    }
    if (argv.currency) {
        config.setCurrency(argv.currency);
    }
    if (argv.assets) {
        let assets = argv.assets.split(',');
        assets = _.map(assets, a => a.trim());
        config.setAssets(assets);
    }
    if (argv.initialFund) {
        config.setStartFund(parseInt(argv.initialFund));
    }
    if (argv.makerTax || argv.takerTax) {
        if (!(argv.makerTax && argv.takerTax)) {
            console.error('--makerTax (-m) and --takerTax (-t) options must be used together');
            process.exit(-1);
        } else {
            config.setTradingFees({
                0: {
                    "maker": parseFloat(argv.makerTax) / 100,
                    "taker": parseFloat(argv.takerTax) / 100
                }
            });
        }
    }

    if (argv.interval) {
        let interval = utils.strToInterval(argv.interval);
        config.setInterval(interval);
    } else {
        config.setInterval(1);
    }
}

process.on('SIGINT', function() {
    console.log('Interrupted');
    process.exit();
});