import './styles.css'
import { catalog } from './catalog.js'
import { renderGallery } from './gallery.js'

renderGallery(document.getElementById('gallery'), catalog)
