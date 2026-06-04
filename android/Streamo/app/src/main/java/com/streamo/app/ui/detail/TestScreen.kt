package com.streamo.app.ui.detail

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun TestScreen(playCallback: (Int, String, Int, Int, String, String?) -> Unit, onBack: () -> Unit = {}) {
    Text(text = playCallback.toString())
}
