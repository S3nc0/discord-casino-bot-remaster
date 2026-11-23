// Every finance scene, by name. Each module exports W, H and a draw function.
import * as bank from './bank.js';
import * as loans from './loans.js';
import * as kyosai from './kyosai.js';
import * as stocks from './stocks.js';
import * as crypto from './crypto.js';
import * as companies from './companies.js';
import * as market from './market.js';

export const SCENES = {
  bank: { W: bank.W, H: bank.H, draw: bank.bank },
  loans: { W: loans.W, H: loans.H, draw: loans.loans },
  kyosai: { W: kyosai.W, H: kyosai.H, draw: kyosai.kyosai },
  stocks: { W: stocks.W, H: stocks.H, draw: stocks.stocks },
  crypto: { W: crypto.W, H: crypto.H, draw: crypto.crypto },
  companies: { W: companies.W, H: companies.H, draw: companies.companies },
  market: { W: market.W, H: market.H, draw: market.market },
};
