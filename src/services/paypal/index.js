const { createPaypalClient, getBaseUrl } = require('./client');
const { createOrdersService, centsToAmountValue } = require('./orders');
const { createPayoutsService } = require('./payouts');

/**
 * Default PayPal facade used by controllers.
 * Pass `{ fetchImpl }` (and/or mock credentials) from tests.
 */
function createPaypalService(options = {}) {
  const client = createPaypalClient(options);
  const orders = createOrdersService(client);
  const payouts = createPayoutsService(client);

  return {
    client,
    orders,
    payouts,
    isMock: () => client.isMock(),
    createOrder: (...args) => orders.createOrder(...args),
    captureOrder: (...args) => orders.captureOrder(...args),
    createPayout: (...args) => payouts.createPayout(...args),
  };
}

const defaultPaypal = createPaypalService();

module.exports = {
  createPaypalService,
  createPaypalClient,
  getBaseUrl,
  centsToAmountValue,
  paypal: defaultPaypal,
};
