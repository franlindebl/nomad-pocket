// Spoken navigation prompts with the device's text-to-speech engine (offline voices). The audio is
// tagged as navigation guidance and takes transient, may-duck audio focus, so music lowers for a
// prompt and comes back after it, the way Android Auto and car head units expect. Not expo-speech:
// it sets neither. A phone without any engine (no Google services, nothing installed) stays
// silent; guidance goes on. The chimes (a reroute, going over the speed limit) are soft notes made
// here (no sound file), played the same way.
package expo.modules.nomadvoice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

private const val UTTERANCE = "nomad-prompt"
private const val CHIME_RATE = 22050
/** Hz and seconds per chime (0 Hz: silence); keep in step with iOS's Chime. */
private val CHIME_NOTES = mapOf(
  // Two soft rising notes, G5 then C6.
  "reroute" to listOf(784.0 to 0.11, 1047.0 to 0.2),
  // A short double beep, D6.
  "speed" to listOf(1175.0 to 0.09, 0.0 to 0.07, 1175.0 to 0.09),
)

class NomadVoiceModule : Module() {
  private var tts: TextToSpeech? = null
  /** null while the engine starts, then whether it did. */
  private var ready: Boolean? = null
  /** The last prompt asked for while the engine was starting. */
  private var pending: Pair<String, String>? = null
  private var focus: AudioFocusRequest? = null
  private val main = Handler(Looper.getMainLooper())
  private var chiming: AudioTrack? = null
  private val chimeSamples = HashMap<String, ShortArray>()

  private fun samples(kind: String): ShortArray = chimeSamples.getOrPut(kind) {
    val out = ArrayList<Short>()
    for ((hz, seconds) in CHIME_NOTES[kind] ?: CHIME_NOTES.getValue("reroute")) {
      val n = (CHIME_RATE * seconds).toInt()
      if (hz == 0.0) {
        repeat(n) { out.add(0) }
        continue
      }
      for (i in 0 until n) {
        val t = i.toDouble() / CHIME_RATE
        // A quick attack and an exponential fade: a bell, not a beep.
        val envelope = minOf(1.0, t / 0.008) * Math.exp(-t * 9)
        out.add((0.45 * envelope * Math.sin(2 * Math.PI * hz * t) * Short.MAX_VALUE).toInt().toShort())
      }
    }
    out.toShortArray()
  }

  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("NomadVoice")

    AsyncFunction("speak") { text: String, language: String ->
      when (ready) {
        true -> say(text, language)
        false -> Unit
        null -> {
          pending = text to language
          start()
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("chime") { kind: String ->
      chime(kind)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { ->
      pending = null
      tts?.stop()
      release()
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      tts?.shutdown()
      tts = null
      release()
    }
  }

  private fun start() {
    if (tts != null) return
    val context = appContext.reactContext ?: return
    // The init callback comes on the main thread.
    tts = TextToSpeech(context) { status ->
      ready = status == TextToSpeech.SUCCESS
      val engine = tts ?: return@TextToSpeech
      if (ready != true) return@TextToSpeech
      engine.setAudioAttributes(attributes)
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}

        override fun onDone(utteranceId: String?) {
          main.post(::release)
        }

        @Deprecated("Deprecated in Android")
        @Suppress("OVERRIDE_DEPRECATION")
        override fun onError(utteranceId: String?) {
          main.post(::release)
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
          main.post(::release)
        }
      })
      pending?.let { (text, language) -> say(text, language) }
      pending = null
    }
  }

  private fun say(text: String, language: String) {
    val engine = tts ?: return
    val locale = Locale.forLanguageTag(language)
    // A Spanish prompt read by an English voice helps no one: without a voice for it, silence.
    if (engine.isLanguageAvailable(locale) < TextToSpeech.LANG_AVAILABLE) return
    if (engine.voice?.locale != locale) engine.language = locale
    acquire()
    engine.speak(text, TextToSpeech.QUEUE_ADD, null, UTTERANCE)
  }

  private fun chime(kind: String) {
    if (chiming != null) return
    val pcm = samples(kind)
    val track = try {
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(CHIME_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build(),
        )
        .setTransferMode(AudioTrack.MODE_STATIC)
        .setBufferSizeInBytes(pcm.size * 2)
        .build()
    } catch (e: Exception) {
      return
    }
    track.write(pcm, 0, pcm.size)
    acquire()
    chiming = track
    track.play()
    // A static track says nothing when it ends: it lasts as long as its samples.
    main.postDelayed({
      track.release()
      chiming = null
      release()
    }, pcm.size * 1000L / CHIME_RATE + 100)
  }

  private fun acquire() {
    if (focus != null) return
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(attributes)
      .build()
    audio?.requestAudioFocus(request)
    focus = request
  }

  // On the main thread (the engine calls back on its own), like everything else here.
  private fun release() {
    val request = focus ?: return
    // Another prompt is queued behind this one, or the chime still plays.
    if (tts?.isSpeaking == true || chiming != null) return
    focus = null
    audio?.abandonAudioFocusRequest(request)
  }
}
