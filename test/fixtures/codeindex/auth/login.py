import hashlib


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


def _internal_helper(s):
    return s.strip()


class LoginService:
    def __init__(self, secret):
        self.secret = secret

    def verify(self, token):
        return token.startswith(self.secret)

    def _private(self):
        return self.secret


PUBLIC_NAME = "login"
