'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createDemoProfileService({
  dataDir,
  getPlayerBalance
}) {
  if (!dataDir) {
    throw new Error(
      'HipiPlay Profile: dataDir no disponible.'
    );
  }

  if (typeof getPlayerBalance !== 'function') {
    throw new Error(
      'HipiPlay Profile: getPlayerBalance no disponible.'
    );
  }

  const PROFILES_FILE =
    path.join(dataDir, 'demo-profiles.json');

  const AUDIT_FILE =
    path.join(dataDir, 'demo-profile-audit.json');

  const AUTH_SESSIONS_FILE =
    path.join(dataDir, 'demo-auth-sessions.json');

  const DEMO_SESSIONS_FILE =
    path.join(dataDir, 'demo-sessions.json');

  const ENCRYPTION_KEY_FILE =
    path.join(dataDir, 'demo-profile-encryption.key');

  const AUTH_TTL_MS =
    7 * 24 * 60 * 60 * 1000;

  function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, {
        recursive: true
      });
    }
  }

  function readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) {
        return fallback;
      }

      const raw =
        fs.readFileSync(file, 'utf8')
          .replace(/^\uFEFF/, '')
          .trim();

      if (!raw) {
        return fallback;
      }

      return JSON.parse(raw);
    } catch (error) {
      console.error(
        'HipiPlay Profile: error leyendo',
        file,
        error
      );

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

  function getEncryptionKey() {
    ensureDataDir();

    if (!fs.existsSync(ENCRYPTION_KEY_FILE)) {
      fs.writeFileSync(
        ENCRYPTION_KEY_FILE,
        crypto.randomBytes(32).toString('base64'),
        {
          encoding: 'utf8',
          flag: 'wx'
        }
      );
    }

    const raw =
      fs.readFileSync(
        ENCRYPTION_KEY_FILE,
        'utf8'
      ).trim();

    const key =
      Buffer.from(raw, 'base64');

    if (key.length !== 32) {
      throw new Error(
        'La llave de cifrado del perfil no es válida.'
      );
    }

    return key;
  }

  const encryptionKey =
    getEncryptionKey();

  function encryptText(value) {
    const cleanValue =
      String(value || '').trim();

    if (!cleanValue) {
      return null;
    }

    const iv =
      crypto.randomBytes(12);

    const cipher =
      crypto.createCipheriv(
        'aes-256-gcm',
        encryptionKey,
        iv
      );

    const encrypted =
      Buffer.concat([
        cipher.update(
          cleanValue,
          'utf8'
        ),
        cipher.final()
      ]);

    const tag =
      cipher.getAuthTag();

    return {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    };
  }

  function decryptText(payload) {
    if (
      !payload ||
      typeof payload !== 'object'
    ) {
      return '';
    }

    const iv =
      Buffer.from(
        String(payload.iv || ''),
        'base64'
      );

    const tag =
      Buffer.from(
        String(payload.tag || ''),
        'base64'
      );

    const encrypted =
      Buffer.from(
        String(payload.data || ''),
        'base64'
      );

    const decipher =
      crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        iv
      );

    decipher.setAuthTag(tag);

    const clear =
      Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

    return clear.toString('utf8');
  }

  function tokenHash(token) {
    return crypto
      .createHash('sha256')
      .update(String(token || ''))
      .digest('hex');
  }

  function protectedHash(scope, value) {
    return crypto
      .createHmac(
        'sha256',
        encryptionKey
      )
      .update(
        `${scope}:${String(value || '')}`
      )
      .digest('hex');
  }

  function cleanupAuthSessions(sessions) {
    const now = Date.now();

    for (
      const [hash, session]
      of Object.entries(sessions)
    ) {
      const expiresAt =
        new Date(
          session?.expiresAt || 0
        ).getTime();

      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= now
      ) {
        delete sessions[hash];
      }
    }

    return sessions;
  }

  function issueDemoAuthToken(playerId) {
    const cleanPlayerId =
      String(playerId || '').trim();

    if (!cleanPlayerId) {
      throw new Error(
        'No se pudo emitir la sesión segura.'
      );
    }

    const sessions =
      cleanupAuthSessions(
        readJson(
          AUTH_SESSIONS_FILE,
          {}
        )
      );

    const token =
      crypto.randomBytes(48)
        .toString('base64url');

    const hash =
      tokenHash(token);

    const now =
      new Date();

    sessions[hash] = {
      playerId: cleanPlayerId,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + AUTH_TTL_MS
      ).toISOString()
    };

    const playerSessions =
      Object.entries(sessions)
        .filter(
          ([, item]) =>
            item?.playerId === cleanPlayerId
        )
        .sort(
          ([, left], [, right]) =>
            new Date(
              left.createdAt || 0
            ).getTime() -
            new Date(
              right.createdAt || 0
            ).getTime()
        );

    while (playerSessions.length > 10) {
      const oldest =
        playerSessions.shift();

      if (oldest) {
        delete sessions[oldest[0]];
      }
    }

    writeJson(
      AUTH_SESSIONS_FILE,
      sessions
    );

    return token;
  }

  function requireDemoAuth(
    req,
    res,
    next
  ) {
    try {
      const authorization =
        String(
          req.get('authorization') || ''
        ).trim();

      const match =
        /^Bearer\s+(.+)$/i.exec(
          authorization
        );

      if (!match) {
        return res.status(401).json({
          ok: false,
          code: 'PROFILE_AUTH_REQUIRED',
          error:
            'Debes validar tu acceso seguro nuevamente.'
        });
      }

      const rawToken =
        match[1].trim();

      const hash =
        tokenHash(rawToken);

      const sessions =
        cleanupAuthSessions(
          readJson(
            AUTH_SESSIONS_FILE,
            {}
          )
        );

      const authSession =
        sessions[hash];

      if (!authSession?.playerId) {
        writeJson(
          AUTH_SESSIONS_FILE,
          sessions
        );

        return res.status(401).json({
          ok: false,
          code: 'PROFILE_SESSION_INVALID',
          error:
            'La sesión segura no es válida o expiró.'
        });
      }

      authSession.lastUsedAt =
        new Date().toISOString();

      sessions[hash] =
        authSession;

      writeJson(
        AUTH_SESSIONS_FILE,
        sessions
      );

      req.demoAuth = {
        playerId:
          String(
            authSession.playerId
          ).trim(),
        tokenHash: hash
      };

      return next();
    } catch (error) {
      return res.status(401).json({
        ok: false,
        code: 'PROFILE_AUTH_FAILED',
        error:
          'No se pudo validar la sesión segura.'
      });
    }
  }

  function getDemoSession(playerId) {
    const sessions =
      readJson(
        DEMO_SESSIONS_FILE,
        {}
      );

    return Object.values(sessions)
      .find((session) => {
        const currentId =
          String(
            session?.playerId ||
            session?.id ||
            ''
          ).trim();

        return currentId === playerId;
      }) || null;
  }

  function buildProfilePayload(playerId) {
    const demoSession =
      getDemoSession(playerId);

    if (!demoSession) {
      throw new Error(
        'La cuenta DEMO no existe.'
      );
    }

    const profiles =
      readJson(
        PROFILES_FILE,
        {}
      );

    const storedProfile =
      profiles[playerId] || null;

    const locked =
      Boolean(
        storedProfile?.profileLocked
      );

    let phone = '';
    let email = '';

    if (locked) {
      phone =
        decryptText(
          storedProfile.phoneEncrypted
        );

      email =
        decryptText(
          storedProfile.emailEncrypted
        );
    }

    const rawBalance =
      Number(
        getPlayerBalance(playerId)
      );

    const balance =
      Number.isFinite(rawBalance)
        ? Math.max(
            0,
            Math.floor(rawBalance)
          )
        : 0;

    const publicId =
      String(
        demoSession.publicId ||
        demoSession.username ||
        ''
      ).toUpperCase();

    const transferId =
      String(
        demoSession.transferId ||
        publicId.replace(/^ID/, '')
      );

    return {
      publicId,
      transferId,
      balance,
      accountType: 'DEMO',
      accountStatus: 'ACTIVE',
      security: 'FINGERPRINT',
      phone,
      email,
      profileCompleted: locked,
      profileLocked: locked,
      createdAt:
        storedProfile?.createdAt ||
        demoSession.createdAt ||
        null,
      lockedAt:
        storedProfile?.lockedAt ||
        null,
      updatedAt:
        storedProfile?.updatedAt ||
        null
    };
  }

  function normalizePhone(value) {
    const digits =
      String(value || '')
        .replace(/\D/g, '');

    if (
      digits.length < 10 ||
      digits.length > 15
    ) {
      throw new Error(
        'El número de teléfono debe contener entre 10 y 15 dígitos.'
      );
    }

    return digits;
  }

  function normalizeEmail(value) {
    const email =
      String(value || '')
        .trim()
        .toLowerCase();

    if (
      email.length < 5 ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      throw new Error(
        'Escribe un correo electrónico válido.'
      );
    }

    return email;
  }

  function registerRoutes(app) {
    app.get(
      '/api/demo/profile',
      requireDemoAuth,
      (req, res) => {
        try {
          res.set(
            'Cache-Control',
            'no-store'
          );

          return res.json({
            ok: true,
            profile:
              buildProfilePayload(
                req.demoAuth.playerId
              )
          });
        } catch (error) {
          return res.status(400).json({
            ok: false,
            error:
              error.message ||
              'No se pudo cargar el perfil.'
          });
        }
      }
    );

    app.post(
      '/api/demo/profile',
      express.json({
        limit: '32kb'
      }),
      requireDemoAuth,
      (req, res) => {
        try {
          res.set(
            'Cache-Control',
            'no-store'
          );

          const playerId =
            req.demoAuth.playerId;

          const profiles =
            readJson(
              PROFILES_FILE,
              {}
            );

          const current =
            profiles[playerId];

          if (current?.profileLocked) {
            return res.status(409).json({
              ok: false,
              code:
                'PROFILE_ALREADY_LOCKED',
              error:
                'El teléfono y el correo ya fueron guardados y no pueden modificarse.',
              profile:
                buildProfilePayload(
                  playerId
                )
            });
          }

          const phone =
            normalizePhone(
              req.body?.phone
            );

          const email =
            normalizeEmail(
              req.body?.email
            );

          const installationId =
            String(
              req.body?.installationId ||
              ''
            )
              .trim()
              .slice(0, 160);

          const now =
            new Date().toISOString();

          profiles[playerId] = {
            playerId,
            phoneEncrypted:
              encryptText(phone),
            emailEncrypted:
              encryptText(email),
            profileCompleted: true,
            profileLocked: true,
            createdAt:
              current?.createdAt || now,
            updatedAt: now,
            lockedAt: now,
            installationHash:
              installationId
                ? protectedHash(
                    'installation',
                    installationId
                  )
                : ''
          };

          writeJson(
            PROFILES_FILE,
            profiles
          );

          const audit =
            readJson(
              AUDIT_FILE,
              []
            );

          audit.push({
            eventId:
              crypto.randomUUID(),
            event:
              'DEMO_PROFILE_LOCKED',
            playerHash:
              protectedHash(
                'player',
                playerId
              ),
            phoneHash:
              protectedHash(
                'phone',
                phone
              ),
            emailHash:
              protectedHash(
                'email',
                email
              ),
            installationHash:
              installationId
                ? protectedHash(
                    'installation',
                    installationId
                  )
                : '',
            ipHash:
              protectedHash(
                'ip',
                req.ip ||
                req.socket?.remoteAddress ||
                ''
              ),
            userAgentHash:
              protectedHash(
                'user-agent',
                req.get('user-agent') || ''
              ),
            createdAt: now
          });

          if (audit.length > 10000) {
            audit.splice(
              0,
              audit.length - 10000
            );
          }

          writeJson(
            AUDIT_FILE,
            audit
          );

          return res.json({
            ok: true,
            message:
              'Perfil guardado y bloqueado correctamente.',
            profile:
              buildProfilePayload(
                playerId
              )
          });
        } catch (error) {
          return res.status(400).json({
            ok: false,
            error:
              error.message ||
              'No se pudo guardar el perfil.'
          });
        }
      }
    );
  }

  return {
    issueDemoAuthToken,
    requireDemoAuth,
    registerRoutes
  };
};