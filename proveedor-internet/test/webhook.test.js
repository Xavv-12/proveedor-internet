'use strict';
const crypto = require('node:crypto');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { preparar, request } = require('./ayuda');

let ctx;
before(async () => { ctx = await preparar(); });
after(async () => { await ctx.cerrar(); });

const cuerpo = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.prueba1', from: '5215500000001', type: 'text', text: { body: 'Hola' } }] } }] }] });
const firmar = (texto, secreto = process.env.WA_APP_SECRET) => `sha256=${crypto.createHmac('sha256', secreto).update(texto).digest('hex')}`;

describe('Webhook de WhatsApp', () => {
  it('responde el reto solo con el token correcto', async () => {
    const ok = await request(ctx.app).get('/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': process.env.WA_VERIFY_TOKEN, 'hub.challenge': '12345' });
    assert.equal(ok.status, 200);
    assert.equal(ok.text, '12345');
    const mal = await request(ctx.app).get('/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '12345' });
    assert.equal(mal.status, 403);
  });

  it('firma inválida o ausente: 401 y no procesa nada', async () => {
    const r1 = await request(ctx.app).post('/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', firmar(cuerpo, 'secreto-falso')).send(cuerpo);
    const r2 = await request(ctx.app).post('/webhooks/whatsapp').set('Content-Type', 'application/json').send(cuerpo);
    const r3 = await request(ctx.app).post('/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', firmar(cuerpo)).send(`${cuerpo} `);
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
    assert.equal(r3.status, 401, 'un solo byte distinto invalida la firma');
    assert.equal(await ctx.db.col('whatsapp_entrantes').countDocuments({}), 0);
  });

  it('firma válida: 200 y procesa el mensaje una sola vez', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await request(ctx.app).post('/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', firmar(cuerpo)).send(cuerpo);
      assert.equal(r.status, 200);
    }
    assert.equal(await ctx.db.col('whatsapp_entrantes').countDocuments({}), 1);
  });
});
