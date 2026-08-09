export type Credentials = {email: string; password: string};
export type CredentialErrors = Partial<Record<keyof Credentials, string>>;

const emailError = (email: string): string | undefined => {
  const normalized = email.trim();

  if (normalized === '') {
    return 'Enter your email address';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Enter a valid email address';
  }
  return undefined;
};

export const validateLogin = (credentials: Credentials): CredentialErrors => {
  const errors: CredentialErrors = {};
  const email = emailError(credentials.email);

  if (email !== undefined) {
    errors.email = email;
  }
  if (credentials.password === '') {
    errors.password = 'Enter your password';
  }

  return errors;
};

export const validateSignup = (credentials: Credentials): CredentialErrors => {
  const errors = validateLogin(credentials);

  if (credentials.password.length < 12) {
    errors.password = 'Use at least 12 characters';
  }
  if (credentials.password.length > 200) {
    errors.password = 'Use no more than 200 characters';
  }

  return errors;
};
