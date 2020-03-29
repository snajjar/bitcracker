/*
// TODO: figure out why this isn't working
import Vue from 'vue';
import VueRouter from 'vue-router';
Vue.use(VueRouter);
*/

import $ from 'jquery';
import Routes from './routes.js';

// 4. Create and mount the root instance.
// Make sure to inject the router with the router option to make the
// whole app router-aware.

$(document).ready(() => {
    const app = new Vue({
        router: Routes
    }).$mount('#app')
});

// Now the app has started!