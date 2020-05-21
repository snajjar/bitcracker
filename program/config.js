const moment = require('moment');

const config = {
    // initial funding
    startFund: 1000,

    // pair
    assetPair: "BTCEUR",

    // trade parameters
    stopLossRatio: 0.05,
    takeProfitRatio: 0.05,
    cumulateGain: false,

    // time range and interval
    interval: null,
    startDate: null,
    endDate: null,

    // fees table
    tradingFees: {
        0: {
            "maker": 0.0016,
            "taker": 0.0026,
        },
        50000: {
            "maker": 0.0014,
            "taker": 0.0024,
        },
        100000: {
            "maker": 0.0012,
            "taker": 0.0022,
        },
        250000: {
            "maker": 0.0010,
            "taker": 0.0020,
        },
        500000: {
            "maker": 0.0008,
            "taker": 0.0018,
        },
        1000000: {
            "maker": 0.0006,
            "taker": 0.0016,
        },
        2500000: {
            "maker": 0.0004,
            "taker": 0.0014,
        },
        5000000: {
            "maker": 0.0002,
            "taker": 0.0012,
        },
        10000000: {
            "maker": 0,
            "taker": 0.0010,
        },
    }

    // tradingFees : {
    //     0: {
    //         "maker": 0.0014,
    //         "taker": 0.0024,
    //     }
    // }
}

const getConfig = function() {
    return config;
}

const setConfig = function(o) {
    config = o;
}

const setStopLossRatio = function(v) {
    config.stopLossRatio = v;
}

const getStopLossRatio = function() {
    return config.stopLossRatio;
}

const setTakeProfitRatio = function(v) {
    config.takeProfitRatio = v;
}

const getTakeProfitRatio = function() {
    return config.takeProfitRatio;
}

const setAssetPair = function(p) {
    config.assetPair = p;
}

const getAssetPair = function() {
    return config.assetPair;
}

const getAssetPairArray = function() {
    return [config.assetpair.substring(0, 3), config.assetPair.substring(3, 6)];
}

const setStartDate = function(dateStr) {
    let m = moment(dateStr, 'DD/MM/YYYY');
    config.startDate = m.unix();
}

const getStartDate = function() {
    return config.startDate;
}

const setEndDate = function(dateStr) {
    let m = moment(dateStr, 'DD/MM/YYYY');
    config.endDate = m.unix();
}

const getEndDate = function() {
    return config.endDate;
}

const setCumulateGain = function(b) {
    config.cumulateGain = b;
}

const getCumulateGain = function() {
    return config.cumulateGain;
}

const getInterval = function() {
    return config.interval;
}

const setInterval = function(i) {
    config.interval = i;
}

const getStartFund = function() {
    return config.startFund;
}

const setStartFund = function(sf) {
    config.startFund = sf;
}

const getTradingFees = function() {
    return config.tradingFees;
}

const setTradingFees = function(tf) {
    config.tradingFees = tf;
}

module.exports = {
    getConfig,
    setConfig,
    setStopLossRatio,
    getStopLossRatio,
    setTakeProfitRatio,
    getTakeProfitRatio,
    setAssetPair,
    getAssetPair,
    getAssetPairArray,
    setStartDate,
    getStartDate,
    setEndDate,
    getEndDate,
    setCumulateGain,
    getCumulateGain,
    getInterval,
    setInterval,
    getStartFund,
    setStartFund,
    getTradingFees,
    setTradingFees
}