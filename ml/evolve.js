/******************************************************************************
 * neuroevolution.js - train bots to trade on bitcoin with a neuroevolution algorithm
 *****************************************************************************/

const _ = require('lodash');
const utils = require('./lib/utils');
const modelData = require('./model');
const csv = require('./lib/csv');
const datatools = require('./lib/datatools');
const NeuroTrader = require('./traders/ml/neurotrader');

// tweak this
const graduationRate = 0.1; // how many traders are selected for reproduction
const nbGenerations = 500000;
const populationSize = 20;

const numberOfGenerationsWithoutTest = 5;

class Population {
    constructor(size, trader) {
        this.size = size;
        this.traders = [];

        if (!trader) {
            for (let i = 0; i < size; i++) {
                this.traders.push(new NeuroTrader());
            }
        } else {
            // create a population from this trader
            this.traders.push(trader);
        }
    }

    // let each trader of the population trade on this data
    async trade(data) {
        let promises = [];
        for (let i = 0; i < this.traders.length; i++) {
            let p = this.traders[i].trade(data)
            promises.push(p);
        }
        return await Promise.all(promises);
    }

    getSortedTraders() {
        let sortedTraders = _.sortBy(this.traders, t => t.score());
        return _.reverse(sortedTraders);
    }

    getBestTraders() {
        let sortedTraders = this.getSortedTraders();
        let positiveSortedTraders = _.filter(sortedTraders, t => t.isReproductible()); // filter out thoses with negative avg trades
        if (positiveSortedTraders.length) {
            return positiveSortedTraders.slice(0, this.size * graduationRate);
        } else {
            return []; // no trader worth mentioning
        }
    }

    // for test purposes
    async cloneBestTraders() {
        let bestTraders = this.getBestTraders();
        let bestTradersClones = [];
        for (var j = 0; j < bestTraders.length; j++) {
            let t = bestTraders[j];
            let clone = await NeuroTrader.clone(t);
            bestTradersClones.push(clone);
        }
        return bestTradersClones;
    }

    disposeWorstTraders() {
        let bestTraders = this.getBestTraders();
        _.each(this.traders, t => {
            if (!bestTraders.includes(t)) {
                t.dispose();
            }
        });
    }

    // randomly choose a parent amongst all best traders
    // returns a Trader object
    async chooseAParent() {
        let parents = this.getBestTraders();
        if (parents.length == 0) {
            return await NeuroTrader.random();
        }

        // compute the total score, so we can deduce for each one of them a probability to be chosen
        let totalScore = 0;
        _.each(parents, t => { totalScore += t.score() });

        if (totalScore <= 0) {
            return await NeuroTrader.random();
        }

        // now choose one
        let chosen = null;
        let r = Math.random();
        let proba = 0;
        _.each(parents, t => {
            proba += t.score() / totalScore;
            //console.log(`r: ${r}, proba: ${proba}`);
            if (proba > r) {
                chosen = t;
                return false;
            }
        });

        return chosen;
    }

    async nextGeneration() {
        let bestTraders = this.getBestTraders();

        // now, build our generation of new traders
        console.log('  - building next generation...');
        let newTraders = [];

        // conserve the best traders
        let newBestTraders = [];
        let lastTraderScore = 0;
        for (var i = 0; i < bestTraders.length; i++) {
            let t = bestTraders[i];
            let newBestTrader = await NeuroTrader.clone(t);
            if (t.score() === lastTraderScore) {
                // if traders have the same score, we shall mutate one
                await newBestTrader.mutate(1);
            }
            newBestTraders.push(newBestTrader);
            lastTraderScore = t.score();
        }
        newTraders = newTraders.concat(newBestTraders);

        // fill the rest with children of them
        for (var i = 0; i < populationSize - bestTraders.length; i++) {
            // build a new trader from 2 parents
            let a = await this.chooseAParent();
            let b = await this.chooseAParent();
            let newTrader = await NeuroTrader.fromParents(a, b);
            await newTrader.mutate();
            newTraders.push(newTrader);
        }

        this.disposeWorstTraders(); // dispose our old generation uneffective traders
        this.traders = newTraders; // replace them
    }
}

var saveTraders = async function(arr, interval) {
    for (var j = 0; j < arr.length; j++) {
        let t = await NeuroTrader.clone(arr[j]);
        await t.model.save(`file://./models/neuroevolution/generation/Cex_BTCEUR_${utils.intervalToStr(interval)}_Top${j}/`);
    }
}

var evolve = async function(interval) {
    // load data from CSV
    let btcData = await csv.getDataForInterval(interval);
    let [trainData, testSample] = datatools.splitData(btcData, 0.8);

    const population = new Population(populationSize);

    for (var i = 0; i < nbGenerations; i++) {
        console.log(`[*] Generation ${i}`);

        console.log('  - evaluating traders on train data...');
        console.time('  - done evaluating traders on train data');
        await population.trade(trainData);
        console.timeEnd('  - done evaluating traders on train data');

        console.log('  - best traders:');
        let bestTraders = population.getBestTraders();
        if (bestTraders.length) {
            await utils.displayTraders(bestTraders);

            // every few generations
            if (i % numberOfGenerationsWithoutTest == 0) {
                console.log('  - evaluating best traders on test data...');
                console.time('  - done evaluating traders on test data');
                // clone traders and evaluate them on test data
                let bestTradersClones = await population.cloneBestTraders();
                for (let trader of bestTradersClones) {
                    await trader.trade(testSample);
                }
                console.timeEnd('  - done evaluating traders on test data');

                console.log('  - tests result:');
                await utils.displayTraders(bestTradersClones);

                // save current best traders
                await saveTraders(bestTraders, interval);
            }
        } else {
            //console.log(`    - no traders worth mentionning`);
            console.log(`    - no traders worth mentionning, here are some loosers from generation (size ${population.getSortedTraders().length})`);
            let firstLoosers = population.getSortedTraders().slice(0, 3);
            await utils.displayTraders(firstLoosers);
        }

        // switch to next generation
        await population.nextGeneration();
    }

    _.each(population.getBestTraders(), t => {
        console.log(`Trader ${t.number} finished with score ${t.score()}`);
    });
}

module.exports = evolve;