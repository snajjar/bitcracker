const config = {
    stopLossRatio: 0.05,
    takeProfitRatio: 0.05,
}

const getConfig = function() {
    return config;
}

const setConfig = function(o) {
    config = o;
}

const setStopLossRatio = function(v) {
    console.log('Set stop loss to ', v);
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

module.exports = {
    getConfig,
    setConfig,
    setStopLossRatio,
    getStopLossRatio,
    setTakeProfitRatio,
    getTakeProfitRatio,
}