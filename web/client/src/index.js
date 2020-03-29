/*
// TODO: figure out why this isn't working
import Vue from 'vue';
import VueRouter from 'vue-router';
Vue.use(VueRouter);
*/

import $ from 'jquery';
import Routes from './routes.js';
import fontawesome from '@fortawesome/fontawesome-free';

$(document).ready(() => {
    const app = new Vue({
        router: Routes
    }).$mount('#app')
});