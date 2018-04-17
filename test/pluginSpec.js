'use strict'

const BtpPacket = require('btp-packet')
const crypto = require('crypto')
const IlpPacket = require('ilp-packet')
const getPort = require('get-port')
const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const PluginMiniAccounts = require('..')

describe('Mini Accounts Plugin', () => {
  beforeEach(async function () {
    const port = await getPort()
    this.plugin = new PluginMiniAccounts({
      port,
      debugHostIldcpInfo: {
        clientAddress: 'test.example'
      }
    })
    this.plugin.connect()

    this.from = 'test.example.35YywQ-3GYiO3MM4tvfaSGhty9NZELIBO3kmilL0Wak'

    this.fulfillment = crypto.randomBytes(32)
    this.condition = crypto.createHash('sha256')
      .update(this.fulfillment)
      .digest()
  })

  afterEach(async function () {
    await this.plugin.disconnect()
  })

  describe('sendData', function () {
    beforeEach(function () {
      this.plugin._call = async (dest, packet) => {
        return { protocolData: [ {
          protocolName: 'ilp',
          contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
          data: IlpPacket.serializeIlpFulfill({
            fulfillment: this.fulfillment,
            data: Buffer.alloc(0)
          })
        } ] }
      }
    })

    it('should return ilp reject when _handlePrepareResponse throws', async function () {
      this.plugin._handlePrepareResponse = () => {
        throw new IlpPacket.Errors.UnreachableError('cannot be reached')
      }

      const result = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
        destination: this.from,
        amount: '123',
        executionCondition: this.condition,
        expiresAt: new Date(Date.now() + 10000),
        data: Buffer.alloc(0)
      }))

      const parsed = IlpPacket.deserializeIlpPacket(result)

      assert.equal(parsed.typeString, 'ilp_reject')
      assert.deepEqual(parsed.data, {
        code: 'F02',
        triggeredBy: 'test.example',
        message: 'cannot be reached',
        data: Buffer.alloc(0)
      })
    })

    it('should return ilp fulfill when in-packet destination is local', async function () {
      const result = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
        destination: this.from,
        amount: '123',
        executionCondition: this.condition,
        expiresAt: new Date(Date.now() + 10000),
        data: Buffer.alloc(0)
      }))

      const parsed = IlpPacket.deserializeIlpPacket(result)

      assert.equal(parsed.typeString, 'ilp_fulfill')
      assert.deepEqual(parsed.data, {
        fulfillment: this.fulfillment,
        data: Buffer.alloc(0)
      })
    })

    it('should throw an error when in-packet destination is remote and no to is specified', async function () {
      try {
        await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
          destination: 'can.not.be.reached',
          amount: '123',
          executionCondition: this.condition,
          expiresAt: new Date(Date.now() + 10000),
          data: Buffer.alloc(0)
        }))
        throw new Error('should not reach here')
      } catch (e) {
        assert.equal(e.message, 'can\'t route packet that is not meant for one of my clients. to=undefined destination=can.not.be.reached prefix=test.example.')
        // ok
      }
    })

    it('should return ilp fulfill when in-packet destination is remote but to is specified', async function () {
      const result = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
        destination: 'can.not.be.reached',
        amount: '123',
        executionCondition: this.condition,
        expiresAt: new Date(Date.now() + 10000),
        data: Buffer.alloc(0)
      }), this.from)

      const parsed = IlpPacket.deserializeIlpPacket(result)

      assert.equal(parsed.typeString, 'ilp_fulfill')
      assert.deepEqual(parsed.data, {
        fulfillment: this.fulfillment,
        data: Buffer.alloc(0)
      })
    })
  })
})
