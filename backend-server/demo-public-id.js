'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJsonObject(file) {
  try {
    if (!fs.existsSync(file)) return {};

    const raw = fs
      .readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim();

    if (!raw) return {};

    const parsed = JSON.parse(raw);

    return parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    console.error(
      'No se pudieron leer los usuarios DEMO:',
      error.message
    );

    return {};
  }
}

function writeJsonAtomic(file, value) {
  const directory = path.dirname(file);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }

  const temporaryFile =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(value, null, 2),
    'utf8'
  );

  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }

  fs.renameSync(
    temporaryFile,
    file
  );
}

function normalizeDemoPublicId(value) {
  const text = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  const match =
    text.match(/^(?:ID)?(\d{5})$/);

  return match
    ? `ID${match[1]}`
    : '';
}

function getSessionPlayerId(session) {
  return String(
    session?.playerId ||
    session?.id ||
    ''
  ).trim();
}

function getUsedPublicIds(
  sessions,
  excludedPlayerId = ''
) {
  const used = new Set();

  for (const session of Object.values(
    sessions || {}
  )) {
    const playerId =
      getSessionPlayerId(session);

    if (
      excludedPlayerId &&
      playerId === excludedPlayerId
    ) {
      continue;
    }

    const publicId =
      normalizeDemoPublicId(
        session?.publicId ||
        session?.username ||
        session?.transferId
      );

    if (publicId) {
      used.add(publicId);
    }
  }

  return used;
}

function generateUniqueDemoPublicId(
  sessions,
  excludedPlayerId = ''
) {
  const used = getUsedPublicIds(
    sessions,
    excludedPlayerId
  );

  for (
    let attempt = 0;
    attempt < 5000;
    attempt += 1
  ) {
    const candidate =
      `ID${crypto.randomInt(
        10000,
        100000
      )}`;

    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'No se pudo generar un ID de usuario disponible.'
  );
}

function ensureDemoPublicId(
  session,
  sessions
) {
  if (
    !session ||
    typeof session !== 'object'
  ) {
    throw new Error(
      'La sesión DEMO no es válida.'
    );
  }

  const sessionMap =
    sessions &&
    typeof sessions === 'object'
      ? sessions
      : {};

  const playerId =
    getSessionPlayerId(session);

  let publicId =
    normalizeDemoPublicId(
      session.publicId ||
      session.username ||
      session.transferId
    );

  const duplicate =
    publicId &&
    Object.values(sessionMap).some(
      (otherSession) => {
        if (
          !otherSession ||
          otherSession === session
        ) {
          return false;
        }

        const otherPlayerId =
          getSessionPlayerId(
            otherSession
          );

        if (
          playerId &&
          otherPlayerId === playerId
        ) {
          return false;
        }

        const otherPublicId =
          normalizeDemoPublicId(
            otherSession.publicId ||
            otherSession.username ||
            otherSession.transferId
          );

        return (
          otherPublicId === publicId
        );
      }
    );

  if (!publicId || duplicate) {
    publicId =
      generateUniqueDemoPublicId(
        sessionMap,
        playerId
      );
  }

  session.publicId = publicId;
  session.transferId =
    publicId.slice(2);

  session.username = publicId;

  return publicId;
}

function migrateDemoPublicIds(
  sessionsFile
) {
  const sessions =
    readJsonObject(sessionsFile);

  let changed = false;

  for (const [
    sessionKey,
    session
  ] of Object.entries(sessions)) {
    if (
      !session ||
      typeof session !== 'object'
    ) {
      continue;
    }

    const before = JSON.stringify({
      playerId: session.playerId,
      id: session.id,
      username: session.username,
      publicId: session.publicId,
      transferId: session.transferId
    });

    if (!session.playerId) {
      session.playerId =
        session.id ||
        sessionKey;
    }

    if (!session.id) {
      session.id =
        session.playerId ||
        sessionKey;
    }

    ensureDemoPublicId(
      session,
      sessions
    );

    const after = JSON.stringify({
      playerId: session.playerId,
      id: session.id,
      username: session.username,
      publicId: session.publicId,
      transferId: session.transferId
    });

    if (before !== after) {
      changed = true;
    }
  }

  if (changed) {
    writeJsonAtomic(
      sessionsFile,
      sessions
    );
  }

  return sessions;
}

function resolveDemoSessionReference(
  sessionsFile,
  value
) {
  const reference =
    String(value || '').trim();

  if (!reference) return null;

  const sessions =
    migrateDemoPublicIds(
      sessionsFile
    );

  const upperReference =
    reference
      .toUpperCase()
      .replace(/\s+/g, '');

  const normalizedPublicId =
    normalizeDemoPublicId(
      upperReference
    );

  const digits =
    normalizedPublicId
      ? normalizedPublicId.slice(2)
      : '';

  for (const session of Object.values(
    sessions
  )) {
    const playerId =
      getSessionPlayerId(session);

    const publicId =
      ensureDemoPublicId(
        session,
        sessions
      );

    const username =
      String(
        session.username || ''
      )
        .trim()
        .toUpperCase();

    const transferId =
      String(
        session.transferId || ''
      ).trim();

    const matches =
      playerId === reference ||
      String(session.id || '') === reference ||
      username === upperReference ||
      (
        normalizedPublicId &&
        publicId === normalizedPublicId
      ) ||
      (
        digits &&
        transferId === digits
      );

    if (!matches) continue;

    return {
      playerId,
      username: publicId,
      publicId,
      transferId:
        publicId.slice(2),
      user: session,
      source: 'demo'
    };
  }

  return null;
}

module.exports = {
  normalizeDemoPublicId,
  generateUniqueDemoPublicId,
  ensureDemoPublicId,
  migrateDemoPublicIds,
  resolveDemoSessionReference
};