'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  ensureDemoPublicId,
  generateUniqueDemoPublicId,
  migrateDemoPublicIds
} = require('./demo-public-id');

module.exports = function registerDemoPasskeyRoutes({
  app,
  dataDir,
  getPlayerBalance,
  setPlayerBalance,
  createTransferPasskeyProof,
  issueDemoAuthToken,
  grantWelcomePromo,

}) {
  if (
    typeof grantWelcomePromo !==
    'function'
  ) {
    throw new Error(
      'HipiPlay DEMO Passkey: grantWelcomePromo is not available.'
    );
  }
  if (!app || typeof app.post !== 'function') {
    throw new Error('HipiPlay DEMO Passkey: app de Express no disponible.');
  }

  const PASSKEYS_FILE = path.join(dataDir, 'demo-passkeys.json');
  const IDENTITIES_FILE = path.join(dataDir, 'demo-identities.json');
  const SESSIONS_FILE = path.join(dataDir, 'demo-sessions.json');
  const WALLETS_FILE = path.join(dataDir, 'demo-wallets.json');
  const SECRET_FILE = path.join(dataDir, 'demo-device-secret.txt');

  migrateDemoPublicIds(SESSIONS_FILE);

  const RP_NAME = process.env.HIPIPLAY_RP_NAME || 'HipiPlay';

  const EXPECTED_ORIGINS = String(
    process.env.HIPIPLAY_ORIGIN || 'https://uribepro2.ddns.net'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const RP_ID =
    process.env.HIPIPLAY_RP_ID ||
    new URL(EXPECTED_ORIGINS[0]).hostname;

  const CEREMONY_TTL_MS = 5 * 60 * 1000;
  const JSON_LIMIT = '2mb';

  const ceremonies = new Map();
  const registrationLocks = new Set();
  const rateBuckets = new Map();

  let webAuthnModulePromise = null;

  function getWebAuthnModule() {
    if (!webAuthnModulePromise) {
      webAuthnModulePromise = import('@simplewebauthn/server');
    }

    return webAuthnModulePromise;
  }

  function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  function readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      console.error('HipiPlay DEMO Passkey: error leyendo', file, error);
      return fallback;
    }
  }

  function writeJson(file, value) {
    ensureDataDir();

    const tempFile =
      `${file}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(value, null, 2),
      'utf8'
    );

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }

    fs.renameSync(tempFile, file);
  }

  function getSecret() {
    ensureDataDir();

    if (!fs.existsSync(SECRET_FILE)) {
      fs.writeFileSync(
        SECRET_FILE,
        crypto.randomBytes(48).toString('hex'),
        'utf8'
      );
    }

    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }

  const DEVICE_SECRET = getSecret();

  function safeText(value, maxLength = 256) {
    return String(value || '').trim().slice(0, maxLength);
  }

  function safeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function uniqueLimited(values, max = 20) {
    return Array.from(
      new Set((values || []).filter(Boolean))
    ).slice(-max);
  }

  function hmac(scope, value) {
    if (!value) return '';

    return crypto
      .createHmac('sha256', DEVICE_SECRET)
      .update(`${scope}:${value}`)
      .digest('hex');
  }

  function randomId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto
      .randomBytes(8)
      .toString('hex')}`;
  }

  function normalizeUserAgentFamily(userAgent) {
    const ua = safeText(userAgent, 512);

    const os = /Android/i.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua)
        ? 'iOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'macOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Other';

    const browser = /Edg\//i.test(ua)
      ? 'Edge'
      : /OPR\//i.test(ua)
        ? 'Opera'
        : /Chrome\//i.test(ua)
          ? 'Chrome'
          : /Firefox\//i.test(ua)
            ? 'Firefox'
            : /Safari\//i.test(ua)
              ? 'Safari'
              : 'Other';

    return `${os}:${browser}`;
  }

  function normalizeDeviceSignals(input) {
    const signals =
      input && typeof input === 'object'
        ? input
        : {};

    return {
      model: safeText(signals.model, 160),
      platform: safeText(signals.platform, 80),

      platformVersionMajor: safeText(
        signals.platformVersionMajor,
        24
      ),

      architecture: safeText(signals.architecture, 40),
      bitness: safeText(signals.bitness, 16),
      language: safeText(signals.language, 32),
      timeZone: safeText(signals.timeZone, 80),

      screenWidth: Math.round(
        safeNumber(signals.screenWidth)
      ),

      screenHeight: Math.round(
        safeNumber(signals.screenHeight)
      ),

      colorDepth: Math.round(
        safeNumber(signals.colorDepth)
      ),

      pixelRatio:
        Math.round(
          safeNumber(signals.pixelRatio, 1) * 100
        ) / 100,

      hardwareConcurrency: Math.round(
        safeNumber(signals.hardwareConcurrency)
      ),

      deviceMemory: safeNumber(signals.deviceMemory),

      maxTouchPoints: Math.round(
        safeNumber(signals.maxTouchPoints)
      ),

      webglVendor: safeText(signals.webglVendor, 160),

      webglRenderer: safeText(
        signals.webglRenderer,
        240
      ),

      canvasHash: safeText(signals.canvasHash, 128),

      uaFamily: safeText(
        signals.uaFamily ||
          normalizeUserAgentFamily(signals.userAgent),
        80
      ),
    };
  }

  function getDeviceHash(deviceSignals) {
    const normalized =
      normalizeDeviceSignals(deviceSignals);

    const meaningfulValues =
      Object.values(normalized).filter((value) => {
        return (
          value !== '' &&
          value !== 0 &&
          value !== null &&
          value !== undefined
        );
      });

    if (meaningfulValues.length < 5) {
      return '';
    }

    return hmac(
      'device',
      JSON.stringify(normalized)
    );
  }

  function getInstallationHash(installationId) {
    const value = safeText(installationId, 200);

    return value
      ? hmac('installation', value)
      : '';
  }

  function getClientIp(req) {
    const forwarded = safeText(
      req.headers['x-forwarded-for'],
      300
    );

    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    return safeText(
      req.socket?.remoteAddress || req.ip,
      120
    );
  }

  function getRequestSignals(req, body) {
    const userAgent = safeText(
      req.headers['user-agent'],
      512
    );

    return {
      deviceHash: getDeviceHash(
        body?.deviceSignals
      ),

      installationHash: getInstallationHash(
        body?.installationId
      ),

      ipHash: hmac(
        'ip',
        getClientIp(req)
      ),

      userAgentHash: hmac(
        'ua',
        normalizeUserAgentFamily(userAgent)
      ),

      userAgentFamily:
        normalizeUserAgentFamily(userAgent),
    };
  }

  function allowRate(
    req,
    scope,
    maximum,
    windowMs
  ) {
    const now = Date.now();

    const rateIdentity = [
      getClientIp(req),
      normalizeUserAgentFamily(
        req.headers['user-agent']
      ),
    ].join('|');

    const key =
      `${scope}:${hmac(
        'rate-client',
        rateIdentity
      )}`;

    const current = rateBuckets.get(key);

    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      return true;
    }

    if (current.count >= maximum) {
      return false;
    }

    current.count += 1;
    return true;
  }

  function cleanupCeremonies() {
    const now = Date.now();

    for (const [id, ceremony] of ceremonies.entries()) {
      if (
        !ceremony ||
        ceremony.expiresAt <= now
      ) {
        ceremonies.delete(id);
      }
    }
  }

  function issueCeremony(data) {
    cleanupCeremonies();

    const ceremonyId =
      randomId('ceremony');

    ceremonies.set(ceremonyId, {
      ...data,
      createdAt: Date.now(),
      expiresAt:
        Date.now() + CEREMONY_TTL_MS,
    });

    return ceremonyId;
  }

  function consumeCeremony(
    ceremonyId,
    expectedType
  ) {
    cleanupCeremonies();

    const id = safeText(
      ceremonyId,
      200
    );

    const ceremony =
      ceremonies.get(id);

    ceremonies.delete(id);

    if (
      !ceremony ||
      ceremony.type !== expectedType ||
      ceremony.expiresAt <= Date.now()
    ) {
      throw new Error(
        'La autorizaciÃ³n expirÃ³. Intenta nuevamente.'
      );
    }

    return ceremony;
  }

  function createInternalWallet(playerId) {
    const cleanPlayerId = safeText(
      playerId,
      100
    )
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-16)
      .toUpperCase();

    return {
      walletId: randomId('wlt_demo'),
      playerId,

      address:
        `HPI-${cleanPlayerId}-${crypto
          .randomBytes(4)
          .toString('hex')
          .toUpperCase()}`,

      network: 'HIPIPLAY-INTERNAL',
      currency: 'HPCOIN',
      type: 'internal_subwallet',
      createdAt: new Date().toISOString(),
    };
  }

  function getPlayerPasskeys(
    passkeys,
    playerId
  ) {
    return Object.values(
      passkeys || {}
    ).filter(
      (item) =>
        item?.playerId === playerId
    );
  }

  function findKnownPlayer({
    sessions,
    identities,
    existingPlayerId,
    signals,
  }) {
    const requestedId = safeText(
      existingPlayerId,
      160
    );

    if (
      requestedId &&
      sessions[requestedId]
    ) {
      return requestedId;
    }

    for (
      const identity of Object.values(
        identities || {}
      )
    ) {
      const playerId = safeText(
        identity?.playerId,
        160
      );

      if (
        !playerId ||
        !sessions[playerId]
      ) {
        continue;
      }

      const installationMatch = Boolean(
        signals.installationHash &&
        Array.isArray(
          identity.installationHashes
        ) &&
        identity.installationHashes.includes(
          signals.installationHash
        )
      );

      const deviceMatch = Boolean(
        signals.deviceHash &&
        Array.isArray(
          identity.deviceHashes
        ) &&
        identity.deviceHashes.includes(
          signals.deviceHash
        )
      );

      if (
        installationMatch ||
        deviceMatch
      ) {
        return playerId;
      }
    }

    return '';
  }

  function upsertIdentity(
    identities,
    playerId,
    signals
  ) {
    const now =
      new Date().toISOString();

    const current =
      identities[playerId] || {
        playerId,
        bonusGranted: true,
        createdAt: now,
        deviceHashes: [],
        installationHashes: [],
        ipHashes: [],
        userAgentHashes: [],
      };

    current.playerId = playerId;
    current.bonusGranted = true;
    current.updatedAt = now;
    current.lastSeenAt = now;

    current.deviceHashes =
      uniqueLimited([
        ...(current.deviceHashes || []),
        signals.deviceHash,
      ]);

    current.installationHashes =
      uniqueLimited([
        ...(current.installationHashes || []),
        signals.installationHash,
      ]);

    current.ipHashes =
      uniqueLimited([
        ...(current.ipHashes || []),
        signals.ipHash,
      ]);

    current.userAgentHashes =
      uniqueLimited([
        ...(current.userAgentHashes || []),
        signals.userAgentHash,
      ]);

    identities[playerId] = current;

    return current;
  }

  function ensureSessionWallet(
    session,
    wallets
  ) {
    const playerId =
      session.playerId || session.id;

    if (!session.wallet) {
      session.wallet =
        wallets[playerId] ||
        createInternalWallet(playerId);
    }

    wallets[playerId] =
      session.wallet;

    return session.wallet;
  }

  function buildSessionPayload(session, sessions = null) {
    const playerId =
      session.playerId || session.id;
    const sessionMap =
      sessions ||
      readJson(
        SESSIONS_FILE,
        {}
      );

    const publicId =
      ensureDemoPublicId(
        session,
        sessionMap
      );

    const currentBalance = Number(
      getPlayerBalance(playerId)
    );

    const balance =
      Number.isFinite(currentBalance)
        ? Math.max(
            0,
            Math.floor(currentBalance)
          )
        : Math.max(
            0,
            Math.floor(
              Number(session.balance || 0)
            )
          );

    session.balance = balance;
    session.updatedAt =
      new Date().toISOString();

    return {
      ok: true,

      token:
        issueDemoAuthToken(playerId),

      playerId,

      user: {
        id: playerId,
        username:
          publicId,
        mode: 'DEMO',
        demo: true,
      },

      wallet: {
        userId: playerId,
        demoBalance: balance,
        realBalance: 0,
        giftLocked: 0,
        serverManaged: true,
        internalWallet: session.wallet,
      },

      internalWallet: session.wallet,
      balance,
    };
  }

  function sendError(
    res,
    status,
    code,
    message,
    extra = {}
  ) {
    res.set(
      'Cache-Control',
      'no-store'
    );

    return res
      .status(status)
      .json({
        ok: false,
        code,
        message,
        ...extra,
      });
  }

  app.post(
    '/api/demo/passkey/status',
    express.json({ limit: JSON_LIMIT }),
    (req, res) => {
      try {
        res.set(
          'Cache-Control',
          'no-store'
        );

        const body = req.body || {};

        const sessions = readJson(
          SESSIONS_FILE,
          {}
        );

        const identities = readJson(
          IDENTITIES_FILE,
          {}
        );

        const passkeys = readJson(
          PASSKEYS_FILE,
          {}
        );

        const signals =
          getRequestSignals(req, body);

        const playerId =
          findKnownPlayer({
            sessions,
            identities,

            existingPlayerId:
              body.existingPlayerId,

            signals,
          });

        const known = Boolean(
          playerId &&
          getPlayerPasskeys(
            passkeys,
            playerId
          ).length > 0
        );

        return res.json({
          ok: true,
          known,

          action:
            known
              ? 'login'
              : 'register',

          buttonLabel:
            known
              ? 'ENTRAR'
              : 'DEMO',
        });
      } catch (error) {
        console.error(
          'Error consultando estado DEMO:',
          error
        );

        return sendError(
          res,
          500,
          'DEMO_STATUS_FAILED',
          'No se pudo validar el acceso DEMO.'
        );
      }
    }
  );

  app.post(
    '/api/demo/passkey/register/options',

    express.json({
      limit: JSON_LIMIT,
    }),

    async (req, res) => {
      try {
        if (
          !allowRate(
            req,
            'demo-register-options',
            20,
            10 * 60 * 1000
          )
        ) {
          return sendError(
            res,
            429,
            'DEMO_RATE_LIMIT',
            'Demasiados intentos. Espera antes de intentar nuevamente.'
          );
        }

        const body = req.body || {};

        const sessions = readJson(
          SESSIONS_FILE,
          {}
        );

        const identities = readJson(
          IDENTITIES_FILE,
          {}
        );

        const passkeys = readJson(
          PASSKEYS_FILE,
          {}
        );

        const signals =
          getRequestSignals(req, body);

        const knownPlayerId =
          findKnownPlayer({
            sessions,
            identities,

            existingPlayerId:
              body.existingPlayerId,

            signals,
          });

        if (
          knownPlayerId &&
          getPlayerPasskeys(
            passkeys,
            knownPlayerId
          ).length > 0
        ) {
          return sendError(
            res,
            409,
            'DEMO_LOGIN_REQUIRED',

            'Este dispositivo ya tiene una cuenta DEMO. Entra con tu huella, rostro o PIN.',

            {
              mode: 'login',
              buttonLabel: 'ENTRAR',
            }
          );
        }

        const playerId =
          knownPlayerId ||
          randomId('usr_demo');

        const existingSession =
          sessions[playerId] || null;
        const username = existingSession
          ? ensureDemoPublicId(
              existingSession,
              sessions
            )
          : generateUniqueDemoPublicId(
              sessions
            );

        const existingPasskeys =
          getPlayerPasskeys(
            passkeys,
            playerId
          );

        const {
          generateRegistrationOptions,
        } =
          await getWebAuthnModule();

        const options =
          await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID: RP_ID,

            userID:
              new Uint8Array(
                Buffer.from(
                  playerId,
                  'utf8'
                )
              ),

            userName: username,
            userDisplayName: username,

            attestationType: 'none',

            excludeCredentials:
              existingPasskeys.map(
                (passkey) => ({
                  id: passkey.id,

                  transports:
                    passkey.transports ||
                    [],
                })
              ),

            authenticatorSelection: {
              residentKey: 'required',
              userVerification: 'required',

              authenticatorAttachment:
                'platform',
            },

            timeout: 120000,
          });

        const ceremonyId =
          issueCeremony({
            type: 'register',

            challenge:
              options.challenge,

            playerId,
            username,

            isExistingPlayer:
              Boolean(existingSession),

            webauthnUserID:
              options.user.id,

            ...signals,
          });

        res.set(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          ok: true,
          mode: 'register',
          ceremonyId,
          options,
        });
      } catch (error) {
        console.error(
          'Error generando registro DEMO Passkey:',
          error
        );

        return sendError(
          res,
          500,
          'DEMO_REGISTER_OPTIONS_FAILED',
          'No se pudo preparar la huella de acceso.'
        );
      }
    }
  );

  app.post(
    '/api/demo/passkey/register/verify',

    express.json({
      limit: JSON_LIMIT,
    }),

    async (req, res) => {
      let lockKey = '';

      try {
        if (
          !allowRate(
            req,
            'demo-register-verify',
            10,
            10 * 60 * 1000
          )
        ) {
          return sendError(
            res,
            429,
            'DEMO_RATE_LIMIT',
            'Demasiados intentos de verificaciÃ³n.'
          );
        }

        const body = req.body || {};

        const ceremony =
          consumeCeremony(
            body.ceremonyId,
            'register'
          );

        const response =
          body.response ||
          body.credential;

        if (!response?.id) {
          return sendError(
            res,
            400,
            'DEMO_CREDENTIAL_MISSING',
            'No se recibiÃ³ la credencial del dispositivo.'
          );
        }

        lockKey =
          ceremony.deviceHash ||
          ceremony.installationHash ||
          ceremony.playerId;

        if (
          registrationLocks.has(
            lockKey
          )
        ) {
          return sendError(
            res,
            409,
            'DEMO_REGISTRATION_IN_PROGRESS',
            'Ya existe un registro DEMO en proceso.'
          );
        }

        registrationLocks.add(
          lockKey
        );

        const {
          verifyRegistrationResponse,
        } =
          await getWebAuthnModule();

        const verification =
          await verifyRegistrationResponse({
            response,

            expectedChallenge:
              ceremony.challenge,

            expectedOrigin:
              EXPECTED_ORIGINS,

            expectedRPID: RP_ID,

            requireUserVerification:
              true,
          });

        if (
          !verification.verified ||
          !verification.registrationInfo
        ) {
          return sendError(
            res,
            400,
            'DEMO_PASSKEY_NOT_VERIFIED',
            'No se pudo verificar la seguridad del dispositivo.'
          );
        }

        const sessions = readJson(
          SESSIONS_FILE,
          {}
        );

        const wallets = readJson(
          WALLETS_FILE,
          {}
        );

        const identities = readJson(
          IDENTITIES_FILE,
          {}
        );

        const passkeys = readJson(
          PASSKEYS_FILE,
          {}
        );

        const latestKnownPlayer =
          findKnownPlayer({
            sessions,
            identities,
            existingPlayerId: '',
            signals: ceremony,
          });

        if (
          !ceremony.isExistingPlayer &&
          latestKnownPlayer &&
          latestKnownPlayer !==
            ceremony.playerId &&
          getPlayerPasskeys(
            passkeys,
            latestKnownPlayer
          ).length > 0
        ) {
          return sendError(
            res,
            409,
            'DEMO_LOGIN_REQUIRED',
            'Este dispositivo ya recibiÃ³ una cuenta DEMO. Usa ENTRAR.',
            {
              mode: 'login',
              buttonLabel: 'ENTRAR',
            }
          );
        }

        const {
          credential,
          credentialDeviceType,
          credentialBackedUp,
        } =
          verification.registrationInfo;

        if (
          passkeys[credential.id]
        ) {
          return sendError(
            res,
            409,
            'DEMO_PASSKEY_EXISTS',
            'Esta credencial ya estÃ¡ registrada. Usa ENTRAR.'
          );
        }

        let session =
          sessions[
            ceremony.playerId
          ] || null;

        const isNewDemo =
          !session;

        if (!session) {
          const wallet =
            createInternalWallet(
              ceremony.playerId
            );

          const initialBalance =
            1000;

          session = {
            playerId:
              ceremony.playerId,

            id:
              ceremony.playerId,

            username:
              ceremony.username,

            mode: 'DEMO',
            status: 'ACTIVE',
            wallet,

            balance:
              initialBalance,

            bonusGranted: true,
            passkeyRequired: true,

            createdAt:
              new Date().toISOString(),

            updatedAt:
              new Date().toISOString(),
          };

          sessions[
            ceremony.playerId
          ] = session;

          wallets[
            ceremony.playerId
          ] = wallet;

          const welcomePromo =
            grantWelcomePromo(
              ceremony.playerId,
              {
                amount:
                  initialBalance,
                referenceId:
                  `WELCOME_PROMO:${ceremony.playerId}`
              }
            );

          setPlayerBalance(
            ceremony.playerId,
            welcomePromo.account.totalBalance
          );
        } else {
          ensureSessionWallet(
            session,
            wallets
          );

          session.passkeyRequired =
            true;

          session.bonusGranted =
            true;

          session.balance = Number(
            getPlayerBalance(
              ceremony.playerId
            )
          );

          session.updatedAt =
            new Date().toISOString();
        }

        passkeys[
          credential.id
        ] = {
          id: credential.id,

          playerId:
            ceremony.playerId,

          webauthnUserID:
            ceremony.webauthnUserID,

          publicKey:
            Buffer.from(
              credential.publicKey
            ).toString('base64'),

          counter:
            Number(
              credential.counter || 0
            ),

          transports:
            credential.transports ||
            response?.response
              ?.transports ||
            [],

          deviceType:
            credentialDeviceType,

          backedUp:
            Boolean(
              credentialBackedUp
            ),

          createdAt:
            new Date().toISOString(),

          updatedAt:
            new Date().toISOString(),
        };

        session.passkeyIds =
          uniqueLimited(
            [
              ...(session.passkeyIds ||
                []),

              credential.id,
            ],
            10
          );

        upsertIdentity(
          identities,
          ceremony.playerId,
          ceremony
        );

        writeJson(
          SESSIONS_FILE,
          sessions
        );

        writeJson(
          WALLETS_FILE,
          wallets
        );

        writeJson(
          PASSKEYS_FILE,
          passkeys
        );

        writeJson(
          IDENTITIES_FILE,
          identities
        );

        const payload =
          buildSessionPayload(session, sessions);

        writeJson(
          SESSIONS_FILE,
          sessions
        );

        res.set(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          ...payload,
          verified: true,
          newDemo: isNewDemo,
          buttonLabel: 'ENTRAR',
        });
      } catch (error) {
        console.error(
          'Error verificando registro DEMO Passkey:',
          error
        );

        return sendError(
          res,
          400,
          'DEMO_REGISTER_VERIFY_FAILED',

          error?.message ||
            'No se pudo verificar la huella de acceso.'
        );
      } finally {
        if (lockKey) {
          registrationLocks.delete(
            lockKey
          );
        }
      }
    }
  );

  app.post(
    '/api/demo/passkey/auth/options',

    express.json({
      limit: JSON_LIMIT,
    }),

    async (req, res) => {
      try {
        if (
          !allowRate(
            req,
            'demo-auth-options',
            20,
            10 * 60 * 1000
          )
        ) {
          return sendError(
            res,
            429,
            'DEMO_RATE_LIMIT',
            'Demasiados intentos de acceso.'
          );
        }

        const passkeys =
          readJson(
            PASSKEYS_FILE,
            {}
          );

        if (
          Object.keys(passkeys)
            .length === 0
        ) {
          return sendError(
            res,
            404,
            'DEMO_PASSKEY_NOT_FOUND',

            'No hay una cuenta DEMO protegida en este dispositivo.',

            {
              mode: 'register',
              buttonLabel: 'DEMO',
            }
          );
        }

        const body =
          req.body || {};

        const signals =
          getRequestSignals(
            req,
            body
          );

        const {
          generateAuthenticationOptions,
        } =
          await getWebAuthnModule();

        const options =
          await generateAuthenticationOptions({
            rpID: RP_ID,

            allowCredentials: [],

            userVerification:
              'required',

            timeout: 120000,
          });

        const ceremonyId =
          issueCeremony({
            type: 'authenticate',

            challenge:
              options.challenge,

            ...signals,
          });

        res.set(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          ok: true,
          mode: 'login',
          ceremonyId,
          options,
        });
      } catch (error) {
        console.error(
          'Error generando autenticaciÃ³n DEMO Passkey:',
          error
        );

        return sendError(
          res,
          500,
          'DEMO_AUTH_OPTIONS_FAILED',
          'No se pudo preparar el acceso seguro.'
        );
      }
    }
  );

  app.post(
    '/api/demo/passkey/auth/verify',

    express.json({
      limit: JSON_LIMIT,
    }),

    async (req, res) => {
      try {
        if (
          !allowRate(
            req,
            'demo-auth-verify',
            20,
            10 * 60 * 1000
          )
        ) {
          return sendError(
            res,
            429,
            'DEMO_RATE_LIMIT',
            'Demasiados intentos de verificaciÃ³n.'
          );
        }

        const body =
          req.body || {};

        const ceremony =
          consumeCeremony(
            body.ceremonyId,
            'authenticate'
          );

        const response =
          body.response ||
          body.credential;

        if (!response?.id) {
          return sendError(
            res,
            400,
            'DEMO_CREDENTIAL_MISSING',
            'No se recibiÃ³ la credencial del dispositivo.'
          );
        }

        const passkeys =
          readJson(
            PASSKEYS_FILE,
            {}
          );

        const passkey =
          passkeys[response.id];

        if (!passkey) {
          return sendError(
            res,
            404,
            'DEMO_PASSKEY_UNKNOWN',
            'La credencial no pertenece a una cuenta DEMO registrada.'
          );
        }

        const {
          verifyAuthenticationResponse,
        } =
          await getWebAuthnModule();

        const verification =
          await verifyAuthenticationResponse({
            response,

            expectedChallenge:
              ceremony.challenge,

            expectedOrigin:
              EXPECTED_ORIGINS,

            expectedRPID:
              RP_ID,

            credential: {
              id: passkey.id,

              publicKey:
                new Uint8Array(
                  Buffer.from(
                    passkey.publicKey,
                    'base64'
                  )
                ),

              counter:
                Number(
                  passkey.counter || 0
                ),

              transports:
                passkey.transports ||
                [],
            },

            requireUserVerification:
              true,
          });

        if (!verification.verified) {
          return sendError(
            res,
            401,
            'DEMO_AUTH_NOT_VERIFIED',
            'La verificaciÃ³n del dispositivo fue rechazada.'
          );
        }

        const sessions =
          readJson(
            SESSIONS_FILE,
            {}
          );

        const wallets =
          readJson(
            WALLETS_FILE,
            {}
          );

        const identities =
          readJson(
            IDENTITIES_FILE,
            {}
          );

        const session =
          sessions[
            passkey.playerId
          ];

        if (!session) {
          return sendError(
            res,
            404,
            'DEMO_SESSION_NOT_FOUND',
            'No se encontrÃ³ la cuenta DEMO asociada.'
          );
        }

        passkey.counter =
          Number(
            verification
              .authenticationInfo
              ?.newCounter ||
              passkey.counter ||
              0
          );

        passkey.updatedAt =
          new Date().toISOString();

        passkey.lastUsedAt =
          new Date().toISOString();

        ensureSessionWallet(
          session,
          wallets
        );

        session.balance =
          Number(
            getPlayerBalance(
              passkey.playerId
            )
          );

        session.updatedAt =
          new Date().toISOString();

        session.lastLoginAt =
          new Date().toISOString();

        upsertIdentity(
          identities,
          passkey.playerId,
          ceremony
        );

        writeJson(
          PASSKEYS_FILE,
          passkeys
        );

        writeJson(
          SESSIONS_FILE,
          sessions
        );

        writeJson(
          WALLETS_FILE,
          wallets
        );

        writeJson(
          IDENTITIES_FILE,
          identities
        );

        const payload =
          buildSessionPayload(session, sessions);

        writeJson(
          SESSIONS_FILE,
          sessions
        );

        res.set(
          'Cache-Control',
          'no-store'
        );

        let passkeyProof = null;

        const transferIntent =
          body.transferIntent;

        if (
          transferIntent !== undefined &&
          transferIntent !== null
        ) {
          const purpose =
            String(
              transferIntent.purpose ||
              ""
            ).trim();

          const toPlayerId =
            String(
              transferIntent.toPlayerId ||
              ""
            ).trim();

          const amount =
            Math.floor(
              Number(
                transferIntent.amount ||
                0
              )
            );

          if (
            purpose !==
            "COIN_TRANSFER_COMPLETE"
          ) {
            throw new Error(
              "La validaciÃ³n no corresponde a una transferencia permitida."
            );
          }

          if (!toPlayerId) {
            throw new Error(
              "Falta el usuario destino de la transferencia."
            );
          }

          if (
            !Number.isFinite(amount) ||
            amount <= 0
          ) {
            throw new Error(
              "El monto de la transferencia no es vÃ¡lido."
            );
          }

          if (
            typeof createTransferPasskeyProof !==
            "function"
          ) {
            throw new Error(
              "El comprobante seguro de transferencia no estÃ¡ disponible."
            );
          }

          const verifiedPlayerId =
            session.playerId ||
            session.id;

          passkeyProof =
            createTransferPasskeyProof({
              type:
                "COIN_TRANSFER_PASSKEY",

              purpose:
                "COIN_TRANSFER_COMPLETE",

              userId:
                verifiedPlayerId,

              toPlayerId,
              amount,

              jti:
                crypto.randomUUID(),

              issuedAt:
                new Date().toISOString(),

              expiresAt:
                new Date(
                  Date.now() +
                  2 * 60 * 1000
                ).toISOString()
            });
        }

        return res.json({
          ...payload,
          verified: true,
          newDemo: false,
          buttonLabel: 'ENTRAR',
          ...(passkeyProof
            ? { passkeyProof }
            : {})
        });
      } catch (error) {
        console.error(
          'Error verificando autenticaciÃ³n DEMO Passkey:',
          error
        );

        return sendError(
          res,
          400,
          'DEMO_AUTH_VERIFY_FAILED',

          error?.message ||
            'No se pudo validar el acceso seguro.'
        );
      }
    }
  );

  app.post(
    '/api/demo/session',

    express.json({
      limit: JSON_LIMIT,
    }),

    async (req, res) => {
      try {
        if (
          !allowRate(
            req,
            'demo-fingerprint-session',
            30,
            10 * 60 * 1000
          )
        ) {
          return sendError(
            res,
            429,
            'DEMO_RATE_LIMIT',
            'Espera unos segundos antes de intentar nuevamente.'
          );
        }

        const body = req.body || {};
        const sessions = readJson(SESSIONS_FILE, {});
        const wallets = readJson(WALLETS_FILE, {});
        const identities = readJson(IDENTITIES_FILE, {});

        const DEVICE_INDEX_FILE = path.join(
          dataDir,
          'demo-device-index.json'
        );

        const PROMO_CLAIMS_FILE = path.join(
          dataDir,
          'demo-promo-claims.json'
        );

        const deviceIndex = readJson(
          DEVICE_INDEX_FILE,
          {
            version: 1,
            installations: {},
            devices: {},
          }
        );

        deviceIndex.version = 1;
        deviceIndex.installations = deviceIndex.installations || {};
        deviceIndex.devices = deviceIndex.devices || {};

        const promoClaims = readJson(
          PROMO_CLAIMS_FILE,
          {
            version: 1,
            byPlayer: {},
            byInstallation: {},
            byDevice: {},
            ipHourly: {},
          }
        );

        promoClaims.version = 1;
        promoClaims.byPlayer = promoClaims.byPlayer || {};
        promoClaims.byInstallation = promoClaims.byInstallation || {};
        promoClaims.byDevice = promoClaims.byDevice || {};
        promoClaims.ipHourly = promoClaims.ipHourly || {};

        const cleanValue = (value, maximum = 500) =>
          safeText(value, maximum).trim();

        const numericValue = (value) => {
          const number = Number(value);
          return Number.isFinite(number) ? number : 0;
        };

        const rawSignals =
          body.deviceSignals &&
          typeof body.deviceSignals === 'object'
            ? body.deviceSignals
            : {};

        const width = numericValue(
          rawSignals.screenWidth || rawSignals.width
        );

        const height = numericValue(
          rawSignals.screenHeight || rawSignals.height
        );

        const screenShort = Math.min(width || 0, height || 0);
        const screenLong = Math.max(width || 0, height || 0);

        const stableDeviceData = {
          platform: cleanValue(rawSignals.platform, 160).toLowerCase(),
          timezone: cleanValue(
            rawSignals.timezone || rawSignals.timeZone,
            160
          ),
          language: cleanValue(rawSignals.language, 80).toLowerCase(),
          screenShort,
          screenLong,
          colorDepth: numericValue(rawSignals.colorDepth),
          pixelRatio: numericValue(
            rawSignals.pixelRatio || rawSignals.devicePixelRatio
          ),
          hardwareConcurrency: numericValue(
            rawSignals.hardwareConcurrency
          ),
          deviceMemory: numericValue(rawSignals.deviceMemory),
          maxTouchPoints: numericValue(rawSignals.maxTouchPoints),
          webglVendor: cleanValue(rawSignals.webglVendor, 300),
          webglRenderer: cleanValue(rawSignals.webglRenderer, 500),
          canvasHash: cleanValue(rawSignals.canvasHash, 300),
        };

        const deviceEvidence = [
          stableDeviceData.platform,
          stableDeviceData.timezone,
          stableDeviceData.screenLong,
          stableDeviceData.maxTouchPoints,
          stableDeviceData.webglVendor,
          stableDeviceData.webglRenderer,
          stableDeviceData.canvasHash,
        ].filter(Boolean).length;

        const signals = getRequestSignals(req, body);

        const installationId = cleanValue(
          body.installationId,
          300
        );

        const installationHash = installationId
          ? hmac('demo-installation', installationId)
          : '';

        const deviceHash =
          deviceEvidence >= 4
            ? hmac(
                'demo-device-composite',
                JSON.stringify(stableDeviceData)
              )
            : '';

        const existingPlayerId = cleanValue(
          body.existingPlayerId,
          200
        );

        const indexedInstallation = installationHash
          ? deviceIndex.installations[installationHash]
          : null;

        const indexedDevice = deviceHash
          ? deviceIndex.devices[deviceHash]
          : null;

        const claimedInstallation = installationHash
          ? promoClaims.byInstallation[installationHash]
          : null;

        const claimedDevice = deviceHash
          ? promoClaims.byDevice[deviceHash]
          : null;

        const candidates = [
          existingPlayerId,
          indexedInstallation?.playerId,
          indexedDevice?.playerId,
          claimedInstallation?.playerId,
          claimedDevice?.playerId,
        ]
          .map((value) => cleanValue(value, 200))
          .filter(Boolean);

        let playerId = '';

        for (const candidate of candidates) {
          if (sessions[candidate]) {
            playerId = candidate;
            break;
          }
        }

        if (!playerId) {
          playerId =
            findKnownPlayer({
              sessions,
              identities,
              existingPlayerId: '',
              signals,
            }) || '';
        }

        const identitySeed = [
          installationHash,
          deviceHash,
          signals.userAgentFamily || '',
        ]
          .filter(Boolean)
          .join('|');

        if (!playerId) {
          playerId = `usr_demo_${hmac(
            'demo-player-id',
            identitySeed || `${Date.now()}:${Math.random()}`
          ).slice(0, 24)}`;
        }

        let session = sessions[playerId] || null;
        const isNewDemo = !session;
        const now = new Date().toISOString();

        const clientIpHash = hmac(
          'demo-promo-ip',
          getClientIp(req)
        );

        const hourNumber = Math.floor(
          Date.now() / (60 * 60 * 1000)
        );

        const ipHourKey = `${hourNumber}:${clientIpHash}`;

        for (const storedKey of Object.keys(promoClaims.ipHourly)) {
          const storedHour = Number(storedKey.split(':')[0]);

          if (
            !Number.isFinite(storedHour) ||
            storedHour < hourNumber - 24
          ) {
            delete promoClaims.ipHourly[storedKey];
          }
        }

        const existingPlayerClaim =
          promoClaims.byPlayer[playerId] || null;

        const existingInstallClaim = installationHash
          ? promoClaims.byInstallation[installationHash] || null
          : null;

        const existingDeviceClaim = deviceHash
          ? promoClaims.byDevice[deviceHash] || null
          : null;

        const currentIpClaims = Number(
          promoClaims.ipHourly[ipHourKey] || 0
        );

        let bonusBlockedReason = '';

        if (existingPlayerClaim) {
          bonusBlockedReason = 'PLAYER_ALREADY_CLAIMED';
        } else if (existingInstallClaim) {
          bonusBlockedReason = 'INSTALLATION_ALREADY_CLAIMED';
        } else if (existingDeviceClaim) {
          bonusBlockedReason = 'DEVICE_ALREADY_CLAIMED';
        } else if (currentIpClaims >= 10) {
          bonusBlockedReason = 'IP_HOURLY_LIMIT';
        }

        const canGrantWelcomeBonus =
          isNewDemo && !bonusBlockedReason;

        if (!session) {
          const wallet = createInternalWallet(playerId);
          const initialBalance = canGrantWelcomeBonus ? 1000 : 0;

          session = {
            playerId,
            id: playerId,
            username: `DEMO-${hmac(
              'demo-public-name',
              playerId
            )
              .slice(0, 8)
              .toUpperCase()}`,
            mode: 'DEMO',
            status: 'ACTIVE',
            wallet,
            balance: initialBalance,
            bonusGranted: canGrantWelcomeBonus,
            bonusBlockedReason: bonusBlockedReason || null,
            passkeyRequired: false,
            security: 'FINGERPRINT',
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
          };

          sessions[playerId] = session;
          wallets[playerId] = wallet;

          if (canGrantWelcomeBonus) {
            const welcomePromo = grantWelcomePromo(
              playerId,
              {
                amount: 1000,
                referenceId: `WELCOME_PROMO:${playerId}`,
              }
            );

            setPlayerBalance(
              playerId,
              welcomePromo.account.totalBalance
            );

            session.balance = Number(
              welcomePromo.account.totalBalance
            );
          } else {
            setPlayerBalance(playerId, 0);
            session.balance = 0;
          }
        } else {
          ensureSessionWallet(session, wallets);
          session.passkeyRequired = false;
          session.security = 'FINGERPRINT';
          session.balance = Number(getPlayerBalance(playerId));
          session.updatedAt = now;
          session.lastLoginAt = now;
        }

        const addUniqueHash = (list, value) =>
          Array.from(
            new Set([
              ...(Array.isArray(list) ? list : []),
              ...(value ? [value] : []),
            ])
          ).slice(-10);

        session.installationHashes = addUniqueHash(
          session.installationHashes,
          installationHash
        );

        session.deviceHashes = addUniqueHash(
          session.deviceHashes,
          deviceHash
        );

        if (installationHash) {
          deviceIndex.installations[installationHash] = {
            playerId,
            firstSeenAt: indexedInstallation?.firstSeenAt || now,
            lastSeenAt: now,
          };
        }

        if (deviceHash) {
          deviceIndex.devices[deviceHash] = {
            playerId,
            firstSeenAt: indexedDevice?.firstSeenAt || now,
            lastSeenAt: now,
            evidence: deviceEvidence,
          };
        }

        const shouldRegisterClaim =
          canGrantWelcomeBonus ||
          Boolean(session.bonusGranted) ||
          Number(session.balance) > 0;

        if (shouldRegisterClaim) {
          const existingClaim =
            existingPlayerClaim ||
            existingInstallClaim ||
            existingDeviceClaim ||
            null;

          const claim = {
            promotionId: 'WELCOME_PROMO',
            playerId,
            amount: Number(existingClaim?.amount || 1000),
            claimedAt: existingClaim?.claimedAt || now,
            updatedAt: now,
          };

          promoClaims.byPlayer[playerId] = claim;

          if (installationHash) {
            promoClaims.byInstallation[installationHash] = claim;
          }

          if (deviceHash) {
            promoClaims.byDevice[deviceHash] = claim;
          }

          if (canGrantWelcomeBonus) {
            promoClaims.ipHourly[ipHourKey] = currentIpClaims + 1;
          }

          session.bonusGranted = true;
          session.bonusBlockedReason = null;
        }

        upsertIdentity(
          identities,
          playerId,
          {
            ...signals,
            installationHash,
            deviceHash,
            deviceEvidence,
          }
        );

        writeJson(SESSIONS_FILE, sessions);
        writeJson(WALLETS_FILE, wallets);
        writeJson(IDENTITIES_FILE, identities);
        writeJson(DEVICE_INDEX_FILE, deviceIndex);
        writeJson(PROMO_CLAIMS_FILE, promoClaims);

        const payload = buildSessionPayload(session, sessions);
        writeJson(SESSIONS_FILE, sessions);

        res.set('Cache-Control', 'no-store');

        return res.json({
          ...payload,
          verified: true,
          authentication: 'FINGERPRINT',
          newDemo: isNewDemo,
          bonusGranted: Boolean(session.bonusGranted),
          bonusBlockedReason: session.bonusBlockedReason || null,
          buttonLabel: 'ENTRAR',
        });
      } catch (error) {
        console.error(
          'Error iniciando DEMO controlado:',
          error
        );

        return sendError(
          res,
          500,
          'DEMO_SESSION_FAILED',
          'No se pudo iniciar la cuenta DEMO.'
        );
      }
    }
  );

  console.log(
    `HipiPlay DEMO fingerprint activo | RP ID: ${RP_ID} | Origen: ${EXPECTED_ORIGINS.join(', ')}`
  );
};
