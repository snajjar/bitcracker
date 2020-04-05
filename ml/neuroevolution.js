/******************************************************************************
 * neuroevolution.js - train bots to trade on bitcoin with a neuroevolution algorithm
 *****************************************************************************/

const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./utils');
const modelData = require('./model');
const csv = require('./csv');
const datatools = require('./datatools');
const colors = require('colors');
const objectHash = require('object-hash');

const buyTax = 0.0026;
const sellTax = 0.0016;
//const buyTax = 0;
//const sellTax = 0;

// tweak this
const nbGenerations = 500000;
const populationSize = 100;

const startingFunding = 1000;
//const penalityPrice = 0.001; // in euro, tax for selling impossible orders (2 SELLS in a row, for instance)

const numberOfGenerationsWithSameSample = 100;
const numberOfGenerationsWithoutTest = 10;

const graduationRate = 0.1; // how many traders are selected for reproduction
const mutationProbability = 1; // probability of mutation to occur on a new trader
const neuronMutationProbability = 0.02; // 1% probability of neuron mutation (if the trader mutates)

const nbDataInput = modelData.nbDataInput;

// The main idea is to spawn a population of traders
// each trader can make 3 possible decisions:
// - BUY (0.26% fee)
// - HOLD
// - SELL (0.16% fee)
// each will start with a value of 1000€
// At the end of the provided period, the top traders (or the last ones that were alive) will be selected for reproduction

class Trader {
    static count = 0;

    // generate a new random trader
    static async random() {
        let t = new Trader();
        await t.mutate(1, 1); // randomize it
        return t;
    }

    static newModel() {
        let nbModelInput = nbDataInput + 2;
        return tf.sequential({
            layers: [
                // We get the nbDataInput from the classic model, plus 2 infos: if we have bitcoins and if we have euros
                tf.layers.dense({ inputShape: [nbModelInput], units: nbModelInput, activation: 'relu' }),
                //tf.layers.dropout(0.8),
                tf.layers.dense({ units: nbModelInput, activation: 'relu' }),
                //tf.layers.dropout(0.8),
                tf.layers.dense({ units: 3, activation: 'softmax' }),
            ]
        });
    }

    static async fromParents(parentA, parentB) {
        let t = await Trader.random();

        let weightsA = [];
        await parentA.reduceWeight(w => { weightsA.push(w); return; });

        let weightsB = [];
        await parentB.reduceWeight(w => { weightsB.push(w); return; });

        let index = 0;
        await t.reduceWeight(w => {
            let val = Math.random() < 0.5 ? weightsA[index] : weightsB[index]
            index++;
            return val;
        });

        return t;
    }

    static async clone(parent) {
        let t = await Trader.random();

        let weights = [];
        await parent.reduceWeight(w => { weights.push(w); return; });

        let index = 0;
        await t.reduceWeight(w => {
            let val = weights[index];
            index++;
            return val;
        });

        t.number = parent.number;

        return t;
    }

    async hash() {
        if (!this.modelHash) {
            let weights = [];
            await this.reduceWeight(w => { weights.push(w); return; });
            this.modelHash = objectHash(weights);
        }
        return this.modelHash;
    }

    async reduceWeight(f) {
        // for each layer, extract weight from parents
        // for each weight, rand() which one we choose
        // then set the result into layer
        let tensors = [];

        for (var i = 0; i < this.model.layers.length; i++) {
            let layer = this.model.layers[i];
            let layerWeights = layer.getWeights(); // Tensor[]
            let newLayerWeights = [];

            for (let j = 0; j < layerWeights.length; j++) {
                let tensor = layerWeights[j];
                let arr = await tensor.array();

                // now build our tensor
                let newArr = [];
                for (let k = 0; k < arr.length; k++) {
                    if (arr[k].length) {
                        let row = [];
                        for (let l = 0; l < arr[k].length; l++) {
                            let val = f(arr[k][l]);
                            if (val !== undefined) {
                                row.push(val);
                            } else {
                                row.push(arr[k][l]);
                            }
                        }
                        newArr.push(row);
                    } else {
                        let val = f(arr[k]);
                        if (val !== undefined) {
                            newArr.push(val);
                        } else {
                            newArr.push(arr[k]);
                        }
                    }
                }

                let dim1 = arr.length;
                let dim2 = arr[0].length;

                if (dim2) {
                    var newTensor = tf.tensor2d(newArr, [dim1, dim2], 'float32');
                } else {
                    var newTensor = tf.tensor1d(newArr);
                }

                newLayerWeights.push(newTensor);
                tensors.push(newTensor);
            }

            layer.setWeights(newLayerWeights);
        }

        // we're done, clean tensors
        _.each(tensors, t => t.dispose());
    }

    async mutate(mp = mutationProbability, nmp = neuronMutationProbability) {
        if (Math.random() < mp) {
            let p = await this.reduceWeight(w => {
                if (Math.random() < nmp) {
                    return Math.random();
                } else {
                    return w;
                }
            });
            delete this.modelHash; // delete the hash, it's not good anymore
        }
    }

    constructor(m) {
        this.number = Trader.count++;
        if (m) {
            this.model = m;
        } else {
            this.model = Trader.newModel();
        }

        // wallet and score values
        this.btcWallet = 0;
        this.eurWallet = startingFunding;
        this.lastBitcoinprice = 0; // keep last bitcoin price for score computations

        // statistics utils
        this.nbTrades = 0;
        this.nbPenalties = 0;
        this.lastBuyPrice = 0;
        this.trades = [];
        this.nbBuy = 0;
        this.nbSell = 0;
        this.nbHold = 0;
    }

    resetTrading() {
        this.btcWallet = 0;
        this.eurWallet = 1000;
    }

    resetStatistics() {
        this.nbTrades = 0;
        this.nbPenalties = 0;
        this.lastBuyPrice = 0;
        this.trades = [];
        this.nbBuy = 0;
        this.nbSell = 0;
        this.nbHold = 0;
    }

    statisticsStr() {
        let positiveTrades = _.filter(this.trades, v => v > 1);
        let negativeTrades = _.filter(this.trades, v => v < 1);
        let totalGain = 1;
        _.each(this.trades, v => totalGain *= v);

        return `${this.trades.length} trades, ${positiveTrades.length} won, ${negativeTrades.length} lost, ${this.nbPenalties} penalities, ${((totalGain)*100).toFixed(1) + "%"} result`;
    }

    tradesStr() {
        return `${this.nbBuy} buy, ${this.nbSell} sell, ${this.nbHold} hold`;
    }

    hasEuros() {
        return this.eurWaller > 0 ? 1 : 0;
    }

    hasBitcoins() {
        return this.btcWallet > 0 ? 1 : 0;
    }

    getInputTensor(periodArray) {
        let arr = [this.hasEuros(), this.hasBitcoins()];
        _.each(periodArray, (period) => {
            let activatedInputData = modelData.activateInput(period);
            _.each(activatedInputData, (v) => {
                arr.push(v);
            });
        });

        return tf.tensor2d(arr, [1, modelData.nbDataInput + 2], 'float32');
    }

    async action(lastPeriods, currentBitcoinPrice) {
        this.lastBitcoinprice = currentBitcoinPrice;

        // build input tensor
        let inputTensor = this.getInputTensor(lastPeriods);
        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();

        // get the action from the output
        var maxVal = _.max(arr);
        var index = arr.indexOf(maxVal);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        switch (index) {
            case 0:
                return this.buy(currentBitcoinPrice);
            case 1:
                return this.hold(currentBitcoinPrice);
            case 2:
                return this.sell(currentBitcoinPrice);
            default:
                throw "Unrecognized action of index: " + index;
        }
    }

    gain() {
        return (this.eurWallet + this.btcWallet * this.lastBitcoinprice) - startingFunding;
    }

    gainStr() {
        let gain = this.gain();
        let gainStr = `${gain.toFixed(0)}€`;
        return gain > 0 ? gainStr.green : gainStr.red;
    }

    avgROI() {
        return _.meanBy(this.trades) || 0; // return 0 if no trades done
    }

    avgROIStr() {
        let avgROI = this.avgROI();
        let avgStr = (this.avgROI() * 100).toFixed(2) + "%";
        return avgROI > 1 ? avgStr.green : avgStr.red;
    }

    score() {
        // score is the global ROI of the trader
        // add the buy/sell tax into account
        return Math.max(this.avgROI() - 1, 0);
    }

    isReproductible() {
        return this.score() > 0;
    }

    addTrade(oldBitcoinPrice, newBitcoinPrice) {
        this.nbTrades++;
        this.trades.push(newBitcoinPrice / oldBitcoinPrice);
    }

    buy(currentBitcoinPrice) {
        this.nbBuy++;
        if (this.eurWallet > 0) {
            this.btcWallet += (this.eurWallet * (1 - buyTax)) / currentBitcoinPrice;
            this.eurWallet = 0;
            this.lastBuyPrice = currentBitcoinPrice;
            return "BUY";
        } else {
            this.nbPenalties++; // cant buy, have no money
            return "";
        }

        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to BUY at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    sell(currentBitcoinPrice) {
        this.nbSell++;
        if (this.btcWallet > 0) {
            this.addTrade(this.lastBuyPrice, currentBitcoinPrice);
            this.eurWallet += (this.btcWallet * (1 - sellTax)) * currentBitcoinPrice;
            this.btcWallet = 0;

            // add last trade statistics
            this.trades.push(currentBitcoinPrice / this.lastBuyPrice);
            return "SELL";
        } else {
            this.nbPenalties++;
            return "";
        }

        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to SELL at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    hold(currentBitcoinPrice) {
        // doing nothing is what i do best
        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to HOLD at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
        this.nbHold++;
        return "HOLD";
    }

    checkNotNaN() {
        if (isNaN(this.score())) {
            this.debug();
            process.exit(-1);
        }
    }

    debug() {
        console.log(`Trader #${this.number} debug:`);
        console.log('  eurWallet: ' + this.eurWallet);
        console.log('  btcWallet: ' + this.btcWallet);
        console.log('  bitcoin price: ' + this.lastBitcoinPrice);
    }

    dispose() {
        this.model.dispose();
    }
}

var btcData = null;

class Population {
    constructor(size, trader) {
        this.size = size;
        this.traders = [];

        if (!trader) {
            for (let i = 0; i < size; i++) {
                this.traders.push(new Trader());
            }
        } else {
            // create a population from this trader
            this.traders.push(trader);
        }
    }

    // let our traders react to the new bitcoin situation
    async next(inputTensor, currentBitcoinPrice) {
        let promises = [];
        for (let i = 0; i < this.traders.length; i++) {
            promises.push(this.traders[i].action(inputTensor, currentBitcoinPrice));
        }
        await Promise.all(promises);
    }

    getSortedTraders() {
        let sortedTraders = _.sortBy(this.traders, t => t.score());
        return _.reverse(sortedTraders);
    }

    getBestTraders() {
        let sortedTraders = this.getSortedTraders();
        let positiveSortedTraders = _.filter(sortedTraders, t => t.isReproductible()); // filter out thoses with negative avg trades
        if (positiveSortedTraders.length) {
            // filter out thoses who have the same score to avoid a dominant strategy to massively take over
            //let uniqPositiveSortedTraders = _.uniqBy(positiveSortedTraders, t => t.score());
            //if (uniqPositiveSortedTraders) {
            //    return uniqPositiveSortedTraders.slice(0, this.size * graduationRate);
            //} else {
            return positiveSortedTraders.slice(0, this.size * graduationRate);
            //}
        } else {
            return []; // no trader worth mentioning
        }
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
            return await Trader.random();
        }

        // compute the total score, so we can deduce for each one of them a probability to be chosen
        let totalScore = 0;
        _.each(parents, t => { totalScore += t.score() });

        if (totalScore <= 0) {
            return await Trader.random();
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
            let newBestTrader = await Trader.clone(t);
            if (t.score() === lastTraderScore) {
                // if traders have the same score, we shall mutate one
                await newBestTrader.mutate(1);
            }
            newBestTraders.push(newBestTrader);
            lastTraderScore = t.score();
        }
        newTraders = newTraders.concat(newBestTraders);

        /*
        // add a mutation of our best traders
        let mutatedBestTraders = [];
        for (var i = 0; i < bestTraders.length; i++) {
            let t = bestTraders[i];
            let mutatedTrader = await Trader.clone(t);
            await mutatedTrader.mutate(1, 0.1); // mutate 10% of neurons
            mutatedBestTraders.push(mutatedTrader);
        }
        newTraders = newTraders.concat(mutatedBestTraders);
        */

        // fill the rest with children of them
        for (var i = 0; i < populationSize - bestTraders.length; i++) {
            // build a new trader from 2 parents
            let a = await this.chooseAParent();
            let b = await this.chooseAParent();
            let newTrader = await Trader.fromParents(a, b);
            await newTrader.mutate();
            newTraders.push(newTrader);
        }

        this.disposeWorstTraders(); // dispose our old generation uneffective traders
        this.traders = newTraders; // replace them
    }
}

var evolve = async function(interval) {
    // load data from CSV
    //btcData = await csv.getData(`./data/Cex_BTCEUR_1d_Refined_Adjusted_NE_Train.csv`);
    btcData = await csv.getData(`./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined.csv`);
    let [trainData, testSample] = datatools.splitData(btcData, 0.8);
    let trainSamples = datatools.kSplitData(trainData, 0.05); // make a lot of small train samples
    let currentTrainSample = _.sample(trainSamples); // rand one of them

    const population = new Population(populationSize);

    let displayTraders = async function(arr) {
        let toDisplay = arr.slice(0, Math.max(arr.length, 5));
        for (var i = 0; i < toDisplay.length; i++) {
            let t = toDisplay[i];
            let hash = await t.hash();
            console.log(`    Trader #${t.number} (${hash}):`);
            console.log(`      avg ROI: ${t.avgROIStr()} gain: ${t.gainStr()}`);
            console.log(`      ${t.statisticsStr()}`);
            console.log(`      ${t.tradesStr()}`);
        }
    }

    for (var i = 0; i < nbGenerations; i++) {
        if (i % numberOfGenerationsWithSameSample == 0) {
            console.log("[*] Changing train sample !");

            // change the current sample
            let otherSamples = _.filter(trainSamples, s => s !== currentTrainSample);
            currentTrainSample = _.sample(otherSamples);
        }

        console.log(`[*] Generation ${i}`);
        //console.log(`- Nb tenstors: ${tf.memory().numTensors}`);

        console.log('  - evaluating traders on train data...');
        console.time('  - done evaluating traders on train data');

        let inputs = currentTrainSample.slice(0, modelData.nbPeriods - 1);
        for (var j = modelData.nbPeriods - 1; j < currentTrainSample.length; j++) {
            let candle = currentTrainSample[j]; // current bitcoin data
            inputs.push(candle);
            let currentBitcoinPrice = candle.close; // close price of the last candle
            await population.next(inputs, currentBitcoinPrice);
            inputs.shift(); // remove 1st element that is not relevant anymore
        }
        console.timeEnd('  - done evaluating traders on train data');

        console.log('  - best traders:');
        let bestTraders = population.getBestTraders();
        if (bestTraders.length) {
            await displayTraders(bestTraders);

            // every few generations
            if (i % numberOfGenerationsWithoutTest == 0) {
                console.log('  - evaluating best traders on test data...');
                console.time('  - done evaluating traders on test data');
                // clone traders and evaluate them on test data
                let bestTradersClones = [];
                for (var j = 0; j < bestTraders.length; j++) {
                    let t = bestTraders[j];
                    let clone = await Trader.clone(t);
                    bestTradersClones.push(clone);
                }

                inputs = testSample.slice(0, modelData.nbPeriods - 1);
                for (var j = modelData.nbPeriods - 1; j < testSample.length; j++) {
                    let candle = testSample[j]; // current bitcoin data
                    inputs.push(candle);
                    let currentBitcoinPrice = candle.close; // close price of the last candle

                    let promises = [];
                    for (let k = 0; k < bestTradersClones.length; k++) {
                        promises.push(bestTradersClones[k].action(inputs, currentBitcoinPrice));
                    }
                    await Promise.all(promises);

                    inputs.shift(); // remove 1st element that is not relevant anymore
                }
                console.timeEnd('  - done evaluating traders on test data');


                console.log('  - tests result:');
                await displayTraders(bestTradersClones);

                // save current best traders
                for (var j = 0; j < Math.min(3, bestTraders.length); j++) {
                    let t = await Trader.clone(bestTraders[j]);
                    await t.model.save(`file://./models/neuroevolution/Cex_BTCEUR_${utils.intervalToStr(interval)}_Top${j}q/`);
                }
            }
        } else {
            //console.log(`    - no traders worth mentionning`);
            console.log(`    - no traders worth mentionning, here are some loosers from generation (size ${population.getSortedTraders().length})`);
            let firstLoosers = population.getSortedTraders().slice(0, 3);
            await displayTraders(firstLoosers);
        }

        // switch to next generation
        await population.nextGeneration();
    }

    _.each(population.getBestTraders(), t => {
        console.log(`Trader ${t.number} finished with score ${t.score()}`);
    });
}

module.exports = {
    evolve,
    Trader
}