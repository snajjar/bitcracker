/******************************************************************************
 * neuroevolution.js - train bots to trade on bitcoin with a neuroevolution algorithm
 *****************************************************************************/

const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./utils');
const modelData = require('./model');
const csv = require('./csv');
const datatools = require('./datatools');

const buyTax = 0.0026;
const sellTax = 0.0016;
//const buyTax = 0;
//const sellTax = 0;

// tweak this
const nbGenerations = 500;
const populationSize = 100;

const startingFunding = 1000;

const graduationRate = 0.1; // how many traders are selected for reproduction
const mutationProbability = 0.3; // 30% probability of mutation
const neuronMutationProbability = 0.01; // 1% probability of neuron mutation (if the trader mutates)

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

    static newModel() {
        return tf.sequential({
            layers: [
                tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput, activation: 'relu' }),
                //tf.layers.dropout(0.8),
                tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
                //tf.layers.dropout(0.8),
                tf.layers.dense({ units: 3, activation: 'softmax' }),
            ]
        });
    }

    /*
    static async fromParents(parentA, parentB) {
        let t = new Trader();

        // for each layer, extract weight from parents
        // for each weight, rand() which one we choose
        // then set the result into layer
        for (var i = 0; i < t.model.layers.length; i++) {
            let layer = t.model.layers[i];

            let layerWeightsA = parentA.model.layers[i].getWeights(); // Tensor[]
            let layerWeightsB = parentB.model.layers[i].getWeights(); // Tensor[]

            let layerWeights = [];
            for (let j = 0; j < layerWeightsA.length; j++) {
                let tensorA = layerWeightsA[j];
                let tensorB = layerWeightsB[j];

                let arrA = await tensorA.array();
                let arrB = await tensorB.array();

                // now build our tensor
                let arr = [];
                for (let k = 0; k < arrA.length; k++) {
                    if (arrA[k].length) {
                        let row = [];
                        for (let l = 0; l < arrA[k].length; l++) {
                            //console.log(`layer ${i} tensor ${j} choosing ${k}:${l}`);
                            row.push(Math.random() > 0.5 ? arrA[k][l] : arrB[k][l]);
                        }
                        arr.push(row);
                    } else {
                        arr.push(Math.random() > 0.5 ? arrA[k] : arrB[k]);
                    }
                }

                let dim1 = arr.length;
                let dim2 = arr[0].length;

                if (dim2) {
                    var tensor = tf.tensor2d(arr, [dim1, dim2], 'float32');
                } else {
                    var tensor = tf.tensor1d(arr);
                }

                layerWeights.push(tensor);
            }

            layer.setWeights(layerWeights);
        }

        return t;
    }
    */

    static async fromParents(parentA, parentB) {


        let t = new Trader();

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
                    var newTensor = tf.tensor2d(arr, [dim1, dim2], 'float32');
                } else {
                    var newTensor = tf.tensor1d(arr);
                }

                newLayerWeights.push(newTensor);
                tensors.push(newTensor);
            }

            layer.setWeights(newLayerWeights);
        }

        // we're done, clean tensors
        _.each(tensors, t => t.dispose());
    }

    async mutate() {
        if (Math.random() < mutationProbability) {
            return await this.reduceWeight(w => {
                if (Math.random() < neuronMutationProbability) {
                    return Math.random();
                } else {
                    return w;
                }
            });
        }
    }

    constructor(m) {
        if (m) {
            this.model = m;
        } else {
            this.model = Trader.newModel();
        }

        this.btcWallet = 0;
        this.eurWallet = startingFunding;
        this.number = Trader.count++;
        this.nbTrades = 0;

        this.lastBitcoinprice = 0; // keep last bitcoin price for score computations
    }

    resetTrading() {
        this.btcWallet = 0;
        this.eurWallet = 1000;
    }

    async action(inputTensor, currentBitcoinPrice) {
        this.lastBitcoinprice = currentBitcoinPrice;

        let outputTensor = this.model.predict(inputTensor);
        //outputTensor.print();
        let arr = await outputTensor.data();

        // get the action from the output
        var maxVal = _.max(arr);
        var index = arr.indexOf(maxVal);

        tf.dispose(outputTensor);

        switch (index) {
            case 0:
                this.buy(currentBitcoinPrice);
                return "SELL";
            case 1:
                this.hold(currentBitcoinPrice);
                return "HOLD";
            case 2:
                this.sell(currentBitcoinPrice);
                return "BUY";
            default:
                throw "Unrecognized action of index: " + index;
        }
    }

    score() {
        // do not award thoses who didn't take any risk ;)
        if (this.nbTrades == 0) {
            return 0;
        } else {
            return this.eurWallet + this.btcWallet * this.lastBitcoinprice;
        }
    }

    buy(currentBitcoinPrice) {
        if (this.eurWallet > 0) {
            this.btcWallet += (this.eurWallet * (1 - buyTax)) / currentBitcoinPrice;
            this.eurWallet = 0;
        }

        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to BUY at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    sell(currentBitcoinPrice) {
        if (this.btcWallet > 0) {
            this.nbTrades++;
            this.eurWallet += (this.btcWallet * (1 - sellTax)) * currentBitcoinPrice;
            this.btcWallet = 0;
        }

        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to SELL at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    hold(currentBitcoinPrice) {
        // doing nothing is what i do best
        //this.checkNotNaN();
        //console.log(`Trader #${this.number} choose to HOLD at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
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
    constructor(size) {
        this.size = size;
        this.traders = [];
        for (let i = 0; i < size; i++) {
            this.traders.push(new Trader());
        }
    }

    // let our traders react to the new bitcoin situation
    async next(inputTensor, currentBitcoinPrice) {
        for (let i = 0; i < this.traders.length; i++) {
            await this.traders[i].action(inputTensor, currentBitcoinPrice);
        }
    }

    // let our traders react to the new bitcoin situation
    async nextTest(inputTensor, currentBitcoinPrice) {

    }

    getBestTraders() {
        let sortedTraders = _.sortBy(this.traders, t => t.score());
        sortedTraders = _.reverse(sortedTraders);
        let positiveSortedTraders = _.filter(sortedTraders, t => t.score() > 0); // filter out thoses who didnt trade
        if (positiveSortedTraders.length) {
            // filter out thoses who have the same score to avoid a dominant strategy to massively take over
            let uniqPositiveSortedTraders = _.uniqBy(positiveSortedTraders, t => t.score());
            if (uniqPositiveSortedTraders) {
                return uniqPositiveSortedTraders.slice(0, this.size * graduationRate);
            } else {
                return positiveSortedTraders.slice(0, this.size * graduationRate);
            }
        } else {
            return sortedTraders.slice(0, this.size * graduationRate);
        }
    }

    disposeWorstTraders(bestTraders) {
        _.each(this.traders, t => {
            if (!bestTraders.includes(t)) {
                t.dispose();
            }
        });
    }

    // randomly choose a parent amongst all best traders
    // returns a Trader object
    chooseAParent(parents) {
        // compute the total score, so we can deduce for each one of them a probability to be chosen
        let totalScore = 0;
        _.each(parents, t => { totalScore += t.score() });

        if (totalScore == 0) {
            return parents[0];
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

    async nextGeneration(bestTraders) {
        // now, build our generation of new traders
        console.log('  - building next generation...');
        let newTraders = [];

        // conserve the best traders
        let newBestTraders = [];
        _.each(bestTraders, t => {
            newBestTraders.push(new Trader(t.model));
        });
        newTraders = newTraders.concat(newBestTraders)

        // fill the rest with children of them
        for (var i = 0; i < populationSize - bestTraders.length; i++) {
            // build a new trader from 2 parents
            let a = this.chooseAParent(bestTraders);
            let b = this.chooseAParent(bestTraders);
            let newTrader = await Trader.fromParents(a, b);
            newTrader.mutate();
            newTraders.push(newTrader);
        }

        this.disposeWorstTraders(bestTraders); // dispose our old generation uneffective traders
        this.traders = newTraders; // replace them
    }
}

const getInputTensor = function(periodArray) {
    let arr = [];
    _.each(periodArray, (period) => {
        let activatedInputData = modelData.activateInput(period);
        _.each(activatedInputData, (v) => {
            arr.push(v);
        });
    });

    return tf.tensor2d(arr, [1, modelData.nbDataInput], 'float32');
}

var evolve = async function(interval) {
    // load data from CSV
    //btcData = await csv.getData(`./data/Cex_BTCEUR_1d_Refined_Adjusted_NE_Train.csv`);
    btcData = await csv.getData(`./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined.csv`);
    let [trainData, testData] = datatools.splitData(btcData);

    const population = new Population(populationSize);

    for (var i = 0; i < nbGenerations; i++) {
        console.log(`[*] Generation ${i}`);

        console.log(`- Nb tenstors: ${tf.memory().numTensors}`);

        console.log('  - evaluating traders on train data...');
        console.time('  - done evaluating traders on train data');
        let inputs = trainData.slice(0, modelData.nbPeriods - 1);
        for (var j = modelData.nbPeriods - 1; j < trainData.length; j++) {
            let candle = trainData[j]; // current bitcoin data
            inputs.push(candle);
            let inputTensor = getInputTensor(inputs);
            let currentBitcoinPrice = candle.close; // close price of the last candle
            await population.next(inputTensor, currentBitcoinPrice);

            tf.dispose(inputTensor);
            inputs.shift(); // remove 1st element that is not relevant anymore
        }
        console.timeEnd('  - done evaluating traders on train data');

        console.log('  - best traders:');
        let bestTraders = population.getBestTraders();
        _.each(bestTraders, (t) => {
            console.log(`    - Trader #${t.number} with result of ${(t.score() - startingFunding).toFixed(0)}€ (${t.nbTrades} trades)`);
        });

        // after a few generations, start evaluating traders on test data
        if (i > 3) {
            console.log('  - evaluating best traders on test data...');
            console.time('  - done evaluating traders on test data');
            _.each(bestTraders, t => t.resetTrading());
            inputs = testData.slice(0, modelData.nbPeriods - 1);
            for (var j = modelData.nbPeriods - 1; j < testData.length; j++) {
                let candle = testData[j]; // current bitcoin data
                inputs.push(candle);
                let inputTensor = getInputTensor(inputs);
                let currentBitcoinPrice = candle.close; // close price of the last candle

                for (let i = 0; i < bestTraders.length; i++) {
                    await bestTraders[i].action(inputTensor, currentBitcoinPrice);
                }

                tf.dispose(inputTensor);
                inputs.shift(); // remove 1st element that is not relevant anymore
            }
            console.timeEnd('  - done evaluating traders on test data');


            console.log('  - tests result:');
            _.each(bestTraders, (t) => {
                console.log(`    - Trader #${t.number} with result of ${(t.score() - startingFunding).toFixed(0)}€ (${t.nbTrades} trades)`);
            });
        }

        // save current model
        let best = population.getBestTraders()[0];
        await best.model.save(`file://./models/neuroevolution/Cex_BTCEUR_${utils.intervalToStr(interval)}/`);

        // switch to next generation
        await population.nextGeneration(bestTraders);
    }

    _.each(population.getBestTraders(), t => {
        console.log(`Trader ${t.number} finished with score ${t.score()}`);
    });
}

module.exports = {
    evolve
}