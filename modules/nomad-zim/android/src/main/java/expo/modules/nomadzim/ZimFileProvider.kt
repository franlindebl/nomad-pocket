package expo.modules.nomadzim

import androidx.core.content.FileProvider

/** Own subclass: two <provider> entries with the same class would clash in the manifest merge. */
class ZimFileProvider : FileProvider()
