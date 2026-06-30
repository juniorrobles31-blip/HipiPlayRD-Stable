'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  getAddress,
  isAddress
} = require('ethers');

module.exports =
function createEthereumSepoliaDepositService({
  dataDir,
  requireDemoAuth,
  addLedgerEntry
}) {
  if (!dataDir) {
    throw new Error(
      'Ethereum Sepolia: dataDir no disponible.'
    );
  }

  if (typeof requireDemoAuth !== 'function') {
    throw new Error(
      'Ethereum Sepolia: requireDemoAuth no disponible.'
    );
  }

  if (typeof addLedgerEntry !== 'function') {
    throw new Error(
      'Ethereum Sepolia: addLedgerEntry no disponible.'
    );
  }

  const WATCH_FILE =
    path.join(
      dataDir,
      'ethereum-sepolia-watch.json'
    );

  const POOL_FILE =
    path.join(
      dataDir,
      'ethereum-sepolia-address-pool.json'
    );

  const DEPOSITS_FILE =
    path.join(
      dataDir,
      'ethereum-sepolia-deposits.json'
    );

  const TRANSACTIONS_FILE =
    path.join(
      dataDir,
      'ethereum-sepolia-transactions.json'
    );

  const MONITOR_STATE_FILE =
    path.join(
      dataDir,
      'ethereum-sepolia-monitor-state.json'
    );

  let reservationInProgress = false;

  function serviceError(
    code,
    message,
    status = 400
  ) {
    const error =
      new Error(message);

    error.code = code;
    error.status = status;

    return error;
  }

  function readJson(
    file,
    fallback
  ) {
    try {
      const raw =
        fs.readFileSync(
          file,
          'utf8'
        ).replace(
          /^\uFEFF/,
          ''
        ).trim();

      if (!raw) {
        return fallback;
      }

      return JSON.parse(raw);
    } catch (error) {
      throw serviceError(
        'ETHEREUM_DATA_READ_FAILED',
        `No se pudo leer ${path.basename(file)}: ${error.message}`,
        500
      );
    }
  }

  function writeJson(
    file,
    value
  ) {
    const content =
      `${JSON.stringify(
        value,
        null,
        2
      )}\n`;

    fs.writeFileSync(
      file,
      content,
      'utf8'
    );
  }

  function ensureJsonFile(
    file,
    fallback
  ) {
    if (!fs.existsSync(file)) {
      writeJson(
        file,
        fallback
      );
    }
  }

  function initializeFiles() {
    fs.mkdirSync(
      dataDir,
      {
        recursive: true
      }
    );

    if (!fs.existsSync(WATCH_FILE)) {
      throw new Error(
        `Falta el descriptor público: ${WATCH_FILE}`
      );
    }

    if (!fs.existsSync(POOL_FILE)) {
      throw new Error(
        `Falta el pool público: ${POOL_FILE}`
      );
    }

    ensureJsonFile(
      DEPOSITS_FILE,
      []
    );

    ensureJsonFile(
      TRANSACTIONS_FILE,
      []
    );

    ensureJsonFile(
      MONITOR_STATE_FILE,
      {
        schemaVersion: 1,
        network: 'SEPOLIA',
        chainId: 11155111,
        lastScannedBlock: null,
        updatedAt: null
      }
    );
  }

  function validateDescriptorAndPool() {
    const descriptor =
      readJson(
        WATCH_FILE,
        null
      );

    const pool =
      readJson(
        POOL_FILE,
        null
      );

    if (
      !descriptor ||
      !pool
    ) {
      throw new Error(
        'El descriptor o el pool Ethereum están vacíos.'
      );
    }

    if (
      descriptor.poolId !==
      pool.poolId
    ) {
      throw new Error(
        'El poolId del descriptor no coincide con el pool.'
      );
    }

    if (
      Number(descriptor.chainId) !==
      11155111 ||
      Number(pool.chainId) !==
      11155111
    ) {
      throw new Error(
        'El chainId no corresponde a Ethereum Sepolia.'
      );
    }

    if (
      String(descriptor.network).toUpperCase() !==
      'SEPOLIA' ||
      String(pool.network).toUpperCase() !==
      'SEPOLIA'
    ) {
      throw new Error(
        'La red configurada no es Sepolia.'
      );
    }

    if (
      descriptor.derivation?.branchPath !==
      pool.branchPath
    ) {
      throw new Error(
        'La ruta HD del descriptor no coincide con el pool.'
      );
    }

    const xpub =
      descriptor.derivation?.extendedPublicKey;

    if (
      typeof xpub !== 'string' ||
      !xpub.startsWith('xpub')
    ) {
      throw new Error(
        'El descriptor no contiene una XPUB válida.'
      );
    }

    if (!Array.isArray(pool.addresses)) {
      throw new Error(
        'El pool no contiene un arreglo de direcciones.'
      );
    }

    if (
      Number(pool.addressCount) !==
      pool.addresses.length
    ) {
      throw new Error(
        'addressCount no coincide con el tamaño real del pool.'
      );
    }

    const uniqueAddresses =
      new Set();

    for (
      const wallet
      of pool.addresses
    ) {
      const address =
        String(
          wallet.address ||
          ''
        );

      if (!isAddress(address)) {
        throw new Error(
          `Dirección Ethereum inválida en índice ${wallet.index}.`
        );
      }

      const normalized =
        getAddress(address)
          .toLowerCase();

      if (
        uniqueAddresses.has(
          normalized
        )
      ) {
        throw new Error(
          `Dirección duplicada en índice ${wallet.index}.`
        );
      }

      uniqueAddresses.add(
        normalized
      );
    }

    return {
      descriptor,
      pool
    };
  }

  function normalizePlayerId(
    value
  ) {
    return String(
      value ||
      ''
    ).trim();
  }

  function normalizeAmount(
    value
  ) {
    const amount =
      Number(value);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw serviceError(
        'INVALID_DEPOSIT_AMOUNT',
        'El monto debe ser mayor a 0.'
      );
    }

    if (amount > 1000000) {
      throw serviceError(
        'DEPOSIT_AMOUNT_TOO_LARGE',
        'El monto excede el límite permitido.'
      );
    }

    const normalized =
      Number(
        amount.toFixed(6)
      );

    if (normalized < 0.000001) {
      throw serviceError(
        'DEPOSIT_AMOUNT_TOO_SMALL',
        'El monto mínimo es 0.000001 MOCK_USDT.'
      );
    }

    return normalized;
  }

  function generateOrderId() {
    const timestamp =
      Date.now()
        .toString(36)
        .toUpperCase();

    const random =
      crypto.randomBytes(5)
        .toString('hex')
        .toUpperCase();

    return `SEP-DEP-${timestamp}-${random}`;
  }

  function loadDeposits() {
    const deposits =
      readJson(
        DEPOSITS_FILE,
        []
      );

    if (!Array.isArray(deposits)) {
      throw new Error(
        'ethereum-sepolia-deposits.json no contiene un arreglo.'
      );
    }

    return deposits;
  }

  function expireStaleOrders(
    deposits,
    pool
  ) {
    const now =
      Date.now();

    let changed =
      false;

    for (
      const order
      of deposits
    ) {
      if (
        String(order.status).toUpperCase() !==
        'PENDING'
      ) {
        continue;
      }

      const expiresAt =
        new Date(
          order.expiresAt ||
          0
        ).getTime();

      if (
        !Number.isFinite(expiresAt) ||
        expiresAt > now
      ) {
        continue;
      }

      order.status =
        'EXPIRED';

      order.blockchainStatus =
        'EXPIRED';

      order.expiredAt =
        new Date().toISOString();

      const wallet =
        pool.addresses.find(
          (item) =>
            Number(item.index) ===
            Number(order.addressIndex)
        );

      if (
        wallet &&
        String(wallet.status).toUpperCase() ===
        'ASSIGNED' &&
        String(
          wallet.assignedDepositId ||
          ''
        ) ===
        String(order.orderId)
      ) {
        wallet.status =
          'RETIRED';

        wallet.retiredAt =
          order.expiredAt;
      }

      changed =
        true;
    }

    return changed;
  }

  function publicDepositOrder(
    order
  ) {
    if (!order) {
      return null;
    }

    return {
      orderId:
        order.orderId,

      playerId:
        order.playerId,

      poolId:
        order.poolId,

      network:
        order.network,

      chainId:
        order.chainId,

      token:
        order.token,

      tokenContract:
        order.tokenContract,

      amount:
        order.amount,

      expectedAmount:
        order.expectedAmount,

      address:
        order.address,

      addressIndex:
        order.addressIndex,

      derivationPath:
        order.derivationPath,

      status:
        order.status,

      blockchainStatus:
        order.blockchainStatus,

      confirmations:
        order.confirmations,

      txHash:
        order.txHash,

      logIndex:
        order.logIndex,

      createdAt:
        order.createdAt,

      expiresAt:
        order.expiresAt,

      confirmedAt:
        order.confirmedAt,

      expiredAt:
        order.expiredAt
    };
  }

  function safeAddLedgerEntry(
    payload
  ) {
    try {
      addLedgerEntry(
        payload
      );
    } catch (error) {
      console.error(
        'Ethereum Sepolia: no se pudo registrar el ledger:',
        error.message
      );
    }
  }

  function reserveDepositAddress({
    playerId,
    amount
  }) {
    if (reservationInProgress) {
      throw serviceError(
        'DEPOSIT_RESERVATION_BUSY',
        'Hay otra reserva en proceso. Intenta nuevamente.',
        503
      );
    }

    reservationInProgress =
      true;

    try {
      const cleanPlayerId =
        normalizePlayerId(
          playerId
        );

      if (!cleanPlayerId) {
        throw serviceError(
          'AUTHENTICATED_PLAYER_REQUIRED',
          'No se pudo identificar al jugador autenticado.',
          401
        );
      }

      const normalizedAmount =
        normalizeAmount(
          amount
        );

      const {
        descriptor,
        pool
      } =
        validateDescriptorAndPool();

      const deposits =
        loadDeposits();

      const poolBefore =
        JSON.stringify(
          pool,
          null,
          2
        );

      const depositsBefore =
        JSON.stringify(
          deposits,
          null,
          2
        );

      const expiredChanged =
        expireStaleOrders(
          deposits,
          pool
        );

      const activeOrder =
        deposits.find(
          (order) =>
            normalizePlayerId(
              order.playerId
            ) ===
              cleanPlayerId &&
            String(
              order.status
            ).toUpperCase() ===
              'PENDING'
        );

      if (activeOrder) {
        if (
          Number(
            activeOrder.expectedAmount
          ) !==
          normalizedAmount
        ) {
          if (expiredChanged) {
            writeJson(
              POOL_FILE,
              pool
            );

            writeJson(
              DEPOSITS_FILE,
              deposits
            );
          }

          throw serviceError(
            'ACTIVE_DEPOSIT_ORDER_EXISTS',
            'Ya tienes una orden de depósito pendiente con otro monto.',
            409
          );
        }

        if (expiredChanged) {
          writeJson(
            POOL_FILE,
            pool
          );

          writeJson(
            DEPOSITS_FILE,
            deposits
          );
        }

        return {
          order:
            activeOrder,

          reusedExistingOrder:
            true
        };
      }

      const wallet =
        pool.addresses
          .slice()
          .sort(
            (left, right) =>
              Number(left.index) -
              Number(right.index)
          )
          .find(
            (item) =>
              String(
                item.status ||
                ''
              ).toUpperCase() ===
              'AVAILABLE'
          );

      if (!wallet) {
        if (expiredChanged) {
          writeJson(
            POOL_FILE,
            pool
          );

          writeJson(
            DEPOSITS_FILE,
            deposits
          );
        }

        throw serviceError(
          'NO_DEPOSIT_ADDRESSES_AVAILABLE',
          'No quedan direcciones Ethereum disponibles.',
          503
        );
      }

      const now =
        new Date();

      const orderId =
        generateOrderId();

      const expiresAt =
        new Date(
          now.getTime() +
          30 * 60 * 1000
        ).toISOString();

      wallet.status =
        'ASSIGNED';

      wallet.assignedDepositId =
        orderId;

      wallet.assignedPlayerId =
        cleanPlayerId;

      wallet.assignedAt =
        now.toISOString();

      const order = {
        schemaVersion: 1,

        orderId,

        playerId:
          cleanPlayerId,

        poolId:
          pool.poolId,

        environment:
          'TEST',

        blockchain:
          'ETHEREUM',

        network:
          'SEPOLIA',

        chainId:
          11155111,

        token:
          'MOCK_USDT',

        tokenStandard:
          'ERC20',

        tokenContract:
          descriptor.tokenContract ||
          null,

        amount:
          normalizedAmount,

        expectedAmount:
          normalizedAmount,

        receivedAmount:
          0,

        creditedAmount:
          0,

        address:
          getAddress(
            wallet.address
          ),

        addressIndex:
          Number(wallet.index),

        derivationPath:
          wallet.derivationPath,

        status:
          'PENDING',

        blockchainStatus:
          'WAITING_PAYMENT',

        confirmations:
          0,

        requiredConfirmations:
          3,

        txHash:
          null,

        logIndex:
          null,

        blockNumber:
          null,

        createdAt:
          now.toISOString(),

        expiresAt,

        detectedAt:
          null,

        confirmedAt:
          null,

        expiredAt:
          null
      };

      deposits.unshift(
        order
      );

      try {
        writeJson(
          POOL_FILE,
          pool
        );

        writeJson(
          DEPOSITS_FILE,
          deposits
        );
      } catch (error) {
        try {
          fs.writeFileSync(
            POOL_FILE,
            `${poolBefore}\n`,
            'utf8'
          );

          fs.writeFileSync(
            DEPOSITS_FILE,
            `${depositsBefore}\n`,
            'utf8'
          );
        } catch {
          // La restauración se intentó sin ocultar el error original.
        }

        throw error;
      }

      safeAddLedgerEntry({
        type:
          'ETHEREUM_DEPOSIT_REQUESTED',

        status:
          'PENDING',

        orderId,

        playerId:
          cleanPlayerId,

        amount:
          normalizedAmount,

        expectedAmount:
          normalizedAmount,

        blockchain:
          'ETHEREUM',

        network:
          'SEPOLIA',

        chainId:
          11155111,

        token:
          'MOCK_USDT',

        address:
          order.address,

        addressIndex:
          order.addressIndex,

        poolId:
          order.poolId
      });

      return {
        order,
        reusedExistingOrder:
          false
      };
    } finally {
      reservationInProgress =
        false;
    }
  }

  function getPlayerDeposits(
    playerId
  ) {
    const cleanPlayerId =
      normalizePlayerId(
        playerId
      );

    return loadDeposits()
      .filter(
        (order) =>
          normalizePlayerId(
            order.playerId
          ) ===
          cleanPlayerId
      )
      .map(
        publicDepositOrder
      );
  }

  function getPlayerDepositById(
    playerId,
    orderId
  ) {
    const cleanPlayerId =
      normalizePlayerId(
        playerId
      );

    const order =
      loadDeposits()
        .find(
          (item) =>
            String(item.orderId) ===
              String(orderId) &&
            normalizePlayerId(
              item.playerId
            ) ===
              cleanPlayerId
        );

    return publicDepositOrder(
      order
    );
  }

  function getStatus() {
    const {
      descriptor,
      pool
    } =
      validateDescriptorAndPool();

    const deposits =
      loadDeposits();

    return {
      ok: true,

      environment:
        'TEST',

      blockchain:
        'ETHEREUM',

      network:
        'SEPOLIA',

      chainId:
        11155111,

      poolId:
        pool.poolId,

      branchPath:
        pool.branchPath,

      addressCount:
        pool.addresses.length,

      availableAddresses:
        pool.addresses.filter(
          (wallet) =>
            String(
              wallet.status
            ).toUpperCase() ===
            'AVAILABLE'
        ).length,

      assignedAddresses:
        pool.addresses.filter(
          (wallet) =>
            String(
              wallet.status
            ).toUpperCase() ===
            'ASSIGNED'
        ).length,

      depositOrders:
        deposits.length,

      pendingOrders:
        deposits.filter(
          (order) =>
            String(
              order.status
            ).toUpperCase() ===
            'PENDING'
        ).length,

      token:
        descriptor.depositAsset,

      tokenContractConfigured:
        Boolean(
          descriptor.tokenContract
        )
    };
  }

  function registerRoutes(
    app
  ) {
    app.post(
      '/api/crypto/ethereum-sepolia/deposits',
      requireDemoAuth,
      (req, res) => {
        try {
          res.set(
            'Cache-Control',
            'no-store'
          );

          const result =
            reserveDepositAddress({
              playerId:
                req.demoAuth.playerId,

              amount:
                req.body?.amount
            });

          return res.status(
            result.reusedExistingOrder
              ? 200
              : 201
          ).json({
            ok: true,

            reusedExistingOrder:
              result.reusedExistingOrder,

            order:
              publicDepositOrder(
                result.order
              )
          });
        } catch (error) {
          return res.status(
            Number(error.status) ||
            400
          ).json({
            ok: false,

            code:
              error.code ||
              'ETHEREUM_DEPOSIT_REQUEST_FAILED',

            error:
              error.message ||
              'No se pudo crear la orden de depósito.'
          });
        }
      }
    );

    app.get(
      '/api/crypto/ethereum-sepolia/deposits',
      requireDemoAuth,
      (req, res) => {
        res.set(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          ok: true,

          deposits:
            getPlayerDeposits(
              req.demoAuth.playerId
            )
        });
      }
    );

    app.get(
      '/api/crypto/ethereum-sepolia/deposits/:orderId',
      requireDemoAuth,
      (req, res) => {
        res.set(
          'Cache-Control',
          'no-store'
        );

        const order =
          getPlayerDepositById(
            req.demoAuth.playerId,
            req.params.orderId
          );

        if (!order) {
          return res.status(
            404
          ).json({
            ok: false,
            code:
              'DEPOSIT_ORDER_NOT_FOUND',
            error:
              'Orden de depósito no encontrada.'
          });
        }

        return res.json({
          ok: true,
          order
        });
      }
    );
  }

  initializeFiles();
  validateDescriptorAndPool();

  return {
    registerRoutes,
    reserveDepositAddress,
    getPlayerDeposits,
    getPlayerDepositById,
    publicDepositOrder,
    getStatus
  };
};