// Side-effect imports: each feature registers its download completion handler,
// item-removal hook and startup init here. Keep one line per feature.
import './content/register';
import './library/register';
import './maps/register';
import './assistant/register';
import './prepare/register';
import './carplay/register';
import './updates/register';
