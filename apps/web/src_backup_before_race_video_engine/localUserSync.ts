import {
  attachServerUserId,
  createLocalUser,
  getLocalUser,
  saveLocalUser
} from './localUserDb';

import { registerUserInBackend } from './userApi';
import { addSyncItem } from './hipiplayDb';
import { persistMobileSessionToIndexedDb } from './persistMobileSession';

export async function syncLocalUserAfterLogin(username: string) {
  const cleanUsername = username.trim();

  if (!cleanUsername) {
    return null;
  }

  let localUser = getLocalUser();

  if (!localUser || localUser.username !== cleanUsername) {
    localUser = createLocalUser(cleanUsername);
  }

  try {
    const response = await registerUserInBackend(localUser);

    const syncedUser = attachServerUserId(response.user.id);

    if (!syncedUser) {
      console.warn('No se pudo vincular serverUserId al usuario local.');
      return null;
    }

    const finalUser = saveLocalUser({
      ...syncedUser,
      coins: response.user.coins,
      syncStatus: 'synced'
    });

    await persistMobileSessionToIndexedDb(finalUser, response.user);

    console.log('HipiPlay usuario guardado en IndexedDB:', {
      username: response.user.username,
      serverUserId: response.user.id,
      localUserId: finalUser.localUserId
    });

    return finalUser;
  } catch (error) {
    console.error('Error sincronizando usuario local:', error);

    const errorUser = saveLocalUser({
      ...localUser,
      syncStatus: 'error'
    });

    await addSyncItem({
      type: 'CREATE_USER',
      userId: errorUser.serverUserId || errorUser.localUserId,
      deviceId: errorUser.deviceId,
      payload: {
        localUserId: errorUser.localUserId,
        username: errorUser.username,
        deviceId: errorUser.deviceId
      }
    });

    return errorUser;
  }
}
