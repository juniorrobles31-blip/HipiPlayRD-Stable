import {
  useEffect,
  useMemo,
  useState
} from 'react';

import {
  CheckCircle2,
  Copy,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  X
} from 'lucide-react';

import {
  readDemoProfileCache,
  writeDemoProfileCache
} from '../demoProfileCache';

import './DemoProfileModal.css';

type DemoProfile = {
  publicId?: string;
  transferId?: string;
  balance?: number;
  accountType?: string;
  accountStatus?: string;
  security?: string;
  phone?: string;
  email?: string;
  profileCompleted?: boolean;
  profileLocked?: boolean;
  createdAt?: string | null;
  lockedAt?: string | null;
  updatedAt?: string | null;
};

type DemoProfileModalProps = {
  user: {
    id: string;
    username: string;
  };
  wallet: {
    demoBalance?: number;
  } | null;
  onClose: () => void;
};

function getProfileToken() {
  const possibleKeys = [
    'hipiplay_demo_auth_token',
    'hipiplay_token',
    'token',
    'authToken'
  ];

  for (const key of possibleKeys) {
    const value =
      localStorage.getItem(key)?.trim();

    if (value) {
      return value;
    }
  }

  return '';
}

function getInstallationId() {
  const storageKey =
    'hipiplay_profile_installation_id';

  let installationId =
    localStorage.getItem(storageKey)?.trim() || '';

  if (installationId) {
    return installationId;
  }

  installationId =
    typeof crypto?.randomUUID === 'function'
      ? `install_${crypto.randomUUID()}`
      : `install_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`;

  localStorage.setItem(
    storageKey,
    installationId
  );

  return installationId;
}

async function requestProfile(
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
) {
  const token = getProfileToken();

  if (!token) {
    throw new Error(
      'Debes cerrar la PWA y entrar nuevamente para validar tu acceso seguro.'
    );
  }

  const response = await fetch(
    '/api/demo/profile',
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'POST'
          ? {
              'Content-Type':
                'application/json'
            }
          : {})
      },
      ...(method === 'POST'
        ? {
            body: JSON.stringify(body || {})
          }
        : {})
    }
  );

  const data =
    await response.json().catch(() => ({}));

  if (!response.ok || data?.ok === false) {
    if (
      response.status === 401 ||
      data?.code === 'PROFILE_AUTH_REQUIRED' ||
      data?.code === 'PROFILE_SESSION_INVALID'
    ) {
      throw new Error(
        'La sesión segura expiró. Cierra completamente la PWA y entra nuevamente.'
      );
    }

    throw new Error(
      data?.error ||
      data?.message ||
      'No se pudo procesar el perfil.'
    );
  }

  return data;
}

function formatCoins(value: unknown) {
  const numericValue = Number(value || 0);

  return new Intl.NumberFormat(
    'es-DO',
    {
      maximumFractionDigits: 0
    }
  ).format(
    Number.isFinite(numericValue)
      ? Math.max(
          0,
          Math.floor(numericValue)
        )
      : 0
  );
}

function formatPhone(value: string) {
  const digits =
    String(value || '').replace(/\D/g, '');

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(
      3,
      6
    )}-${digits.slice(6)}`;
  }

  return value;
}

export function DemoProfileModal({
  user,
  wallet,
  onClose
}: DemoProfileModalProps) {
  const [profile, setProfile] =
    useState<DemoProfile | null>(null);

  const [phone, setPhone] =
    useState('');

  const [email, setEmail] =
    useState('');

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState('');

  const [error, setError] =
    useState('');

  const locked =
    Boolean(profile?.profileLocked);

  const publicId =
    String(
      profile?.publicId ||
      user.username ||
      ''
    ).toUpperCase();

  const balance =
    profile?.balance ??
    wallet?.demoBalance ??
    0;

  const accountStatus =
    String(
      profile?.accountStatus ||
      'ACTIVE'
    ).toUpperCase() === 'ACTIVE'
      ? 'Activa'
      : String(
          profile?.accountStatus ||
          'Activa'
        );

  const securityLabel =
    profile?.security === 'PASSKEY'
      ? 'Fingerprint del dispositivo'
      : 'Fingerprint del dispositivo';

  const phonePreview =
    useMemo(
      () => formatPhone(phone),
      [phone]
    );

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      setError('');
      setMessage('');

      try {
        const cached =
          await readDemoProfileCache(
            user.id
          );

        if (
          active &&
          cached?.profile
        ) {
          setProfile(cached.profile);
          setPhone(
            cached.profile.phone || ''
          );
          setEmail(
            cached.profile.email || ''
          );
        }

        const data =
          await requestProfile('GET');

        if (!active) {
          return;
        }

        const serverProfile =
          data.profile as DemoProfile;

        setProfile(serverProfile);
        setPhone(
          serverProfile?.phone || ''
        );
        setEmail(
          serverProfile?.email || ''
        );

        await writeDemoProfileCache(
          user.id,
          serverProfile
        );
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No se pudo cargar el perfil.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [user.id]);

  async function copyPublicId() {
    try {
      await navigator.clipboard.writeText(
        publicId
      );

      setMessage(
        'ID copiado correctamente.'
      );
      setError('');
    } catch {
      setError(
        'No se pudo copiar el ID.'
      );
    }
  }

  async function saveProfile() {
    if (locked || saving) {
      return;
    }

    const cleanPhone =
      phone.replace(/\D/g, '');

    const cleanEmail =
      email.trim().toLowerCase();

    if (
      cleanPhone.length < 10 ||
      cleanPhone.length > 15
    ) {
      setError(
        'El teléfono debe contener entre 10 y 15 dígitos.'
      );
      return;
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        cleanEmail
      )
    ) {
      setError(
        'Escribe un correo electrónico válido.'
      );
      return;
    }

    const confirmed =
      window.confirm(
        'Revisa cuidadosamente tu teléfono y correo. Después de guardarlos no podrás modificarlos.\n\n¿Confirmas que los datos son correctos?'
      );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const data =
        await requestProfile(
          'POST',
          {
            phone: cleanPhone,
            email: cleanEmail,
            installationId:
              getInstallationId()
          }
        );

      const savedProfile =
        data.profile as DemoProfile;

      setProfile(savedProfile);
      setPhone(
        savedProfile?.phone ||
        cleanPhone
      );
      setEmail(
        savedProfile?.email ||
        cleanEmail
      );

      await writeDemoProfileCache(
        user.id,
        savedProfile
      );

      setMessage(
        'Datos verificados, guardados y bloqueados correctamente.'
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'No se pudo guardar el perfil.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="hipi-profile-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="hipi-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hipi-profile-title"
      >
        <button
          type="button"
          className="hipi-profile-close"
          onClick={onClose}
          aria-label="Cerrar perfil"
        >
          <X size={24} />
        </button>

        <header className="hipi-profile-header">
          <div className="hipi-profile-avatar">
            <UserRound size={44} />
          </div>

          <div>
            <span className="hipi-profile-eyebrow">
              Mi cuenta
            </span>

            <h2 id="hipi-profile-title">
              Mi perfil
            </h2>
          </div>
        </header>

        <div className="hipi-profile-identity">
          <strong>
            Usuario HipiPlay
          </strong>

          <div className="hipi-profile-public-id">
            <span>{publicId}</span>

            <button
              type="button"
              onClick={copyPublicId}
            >
              <Copy size={17} />
              Copiar ID
            </button>
          </div>
        </div>

        {loading && (
          <div className="hipi-profile-notice">
            Sincronizando perfil...
          </div>
        )}

        <div className="hipi-profile-information">
          <div>
            <span>
              Monedas disponibles
            </span>
            <strong>
              {formatCoins(balance)}
            </strong>
          </div>

          <div>
            <span>
              Tipo de cuenta
            </span>
            <strong>DEMO</strong>
          </div>

          <div>
            <span>Estado</span>
            <strong>{accountStatus}</strong>
          </div>

          <div>
            <span>Seguridad</span>
            <strong>
              <ShieldCheck size={17} />
              {securityLabel}
            </strong>
          </div>
        </div>

        {locked && (
          <div className="hipi-profile-locked">
            <CheckCircle2 size={21} />

            <div>
              <strong>
                Datos verificados y guardados
              </strong>

              <span>
                El teléfono y el correo ya no pueden modificarse.
              </span>
            </div>
          </div>
        )}

        <div className="hipi-profile-fields">
          <label>
            <span>
              <Phone size={18} />
              Número de teléfono
            </span>

            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={
                locked
                  ? phonePreview
                  : phone
              }
              onChange={(event) => {
                if (!locked) {
                  setPhone(
                    event.target.value
                  );
                }
              }}
              placeholder="809-000-0000"
              readOnly={locked}
              disabled={loading || saving}
            />

            {locked && (
              <LockKeyhole
                className="hipi-profile-field-lock"
                size={17}
              />
            )}
          </label>

          <label>
            <span>
              <Mail size={18} />
              Correo electrónico
            </span>

            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                if (!locked) {
                  setEmail(
                    event.target.value
                  );
                }
              }}
              placeholder="usuario@correo.com"
              readOnly={locked}
              disabled={loading || saving}
            />

            {locked && (
              <LockKeyhole
                className="hipi-profile-field-lock"
                size={17}
              />
            )}
          </label>
        </div>

        {!locked && !loading && (
          <div className="hipi-profile-warning">
            Revisa bien tus datos. Una vez guardados, no podrán modificarse.
          </div>
        )}

        {error && (
          <div className="hipi-profile-error">
            {error}
          </div>
        )}

        {message && (
          <div className="hipi-profile-success">
            {message}
          </div>
        )}

        {!locked && (
          <button
            type="button"
            className="hipi-profile-save"
            onClick={saveProfile}
            disabled={
              loading ||
              saving ||
              !phone.trim() ||
              !email.trim()
            }
          >
            {saving
              ? 'Guardando...'
              : 'Guardar datos'}
          </button>
        )}
      </section>
    </div>
  );
}