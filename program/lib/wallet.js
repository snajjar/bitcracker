const _ = require('lodash');
const colors = require('colors');
const HRNumbers = require('human-readable-numbers');

class Wallet {
    static clone(w) {
        let wallet = new Wallet();
        wallet.mainCurrency = w.mainCurrency;
        wallet.assets = _.cloneDeep(w.assets);
        return wallet;
    }

    // assets: array of names of asset we want to trade
    constructor(mainCurrency = "EUR") {
        this.mainCurrency = mainCurrency; // the currency that will be the base value
        this.assets = {};
        this.reset();
    }

    getMainCurrency() {
        return this.mainCurrency;
    }

    reset() {
        this.assets = {};
        _.each(this.assetsNames, name => {
            this.init(name);
        });
    }

    init(asset) {
        if (asset == undefined) {
            throw new Error("asset cant be undefined");
        }

        if (typeof asset !== "string") {
            throw new Error("Asset should be a string");
        }

        this.assets[asset] = {
            amount: 0,
            price: null,
        }

        if (asset == this.mainCurrency) {
            this.assets[asset].price = 1;
        }
    }

    get(name) {
        if (!this.assets[name]) {
            this.init(name);
        }
        return this.assets[name];
    }

    setAmount(name, v) {
        this.get(name).amount = v;
    }

    getAmount(name) {
        let asset = this.get(name);
        if (asset) {
            return asset.amount;
        } else {
            return 0;
        }
    }

    getCurrencyAmount() {
        return this.getAmount(this.getMainCurrency());
    }

    setPrice(name, v) {
        this.get(name).price = v;
    }

    getPrice(name) {
        return this.get(name).price;
    }

    getPrices() {
        return _.mapValues(this.assets, a => a.price);
    }

    setAmounts(o) {
        _.each(o, (amount, name) => {
            this.setAmount(name, amount);
        });
    }

    setPrices(o) {
        _.each(o, (price, name) => {
            this.setPrice(name, price);
        });
    }

    has(asset) {
        return this.getAmount(asset) > 0;
    }

    // return the asset that contains the most value
    getMaxAsset() {
        let maxValue = -Infinity;
        let maxAsset = null;
        _.each(this.assets, (asset, assetName) => {
            if (this.value(assetName) > maxValue) {
                maxValue = this.value(assetName);
                maxAsset = assetName;
            }
        });

        return maxAsset;
    }

    // compute the current value of the wallet
    value(assetName = null) {
        if (assetName) {
            let asset = this.get(assetName);
            console.log('Value ' + assetName + ':', asset.amount * asset.price);
            return asset.amount * asset.price;
        } else {
            let s = 0;
            _.each(this.assets, asset => {
                s += asset.amount * asset.price;
            });
            return s;
        }
    }

    display() {
        //console.log('================================================');
        console.log('');
        _.each(this.assets, (asset, assetName) => {
            console.log(` ${assetName}: ${asset.amount.toFixed(3)} (${HRNumbers.toHumanString(asset.amount * asset.price)}€)`);
        });
        console.log('');
        //console.log('================================================');
    }

    coloredStr() {
        let s = `${this.getMainCurrency()}=${HRNumbers.toHumanString(this.getAmount(this.getMainCurrency())).cyan}`;
        _.each(this.assets, (asset, assetName) => {
            if (assetName != this.getMainCurrency()) {
                s += ` ${assetName}=${HRNumbers.toHumanString(this.getAmount(assetName)).cyan}`;
            }
        });
        return s;
    }
}

module.exports = Wallet;