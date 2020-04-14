const moment = require('moment');

const config = {
    // trade parameters
    stopLossRatio: 0.05,
    takeProfitRatio: 0.05,
    cumulateGain: false,

    // time range and interval
    interval: null,
    startDate: null,
    endDate: null,
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

module.exports = {
    getConfig,
    setConfig,
    setStopLossRatio,
    getStopLossRatio,
    setTakeProfitRatio,
    getTakeProfitRatio,
    setStartDate,
    getStartDate,
    setEndDate,
    getEndDate,
    setCumulateGain,
    getCumulateGain,
    getInterval,
    setInterval
}