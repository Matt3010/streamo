package com.streamo.app.navigation

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Animation
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.LocalReducedEffects
import com.streamo.app.ui.common.glassCapsule
import dev.chrisbanes.haze.HazeState

/**
 * Definizione di un tab condivisa fra [RootTabView] (phone) e [TabletRootView]
 * (tablet portrait). In landscape il tablet usa invece una NavigationRail
 * con il suo set locale di tab, ma lo stato di selezione e la navigazione
 * condividono comunque [NavRoutes].
 */
internal sealed class Tab(
    val route: NavRoutes,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    data object Home : Tab(NavRoutes.Home, "Home", Icons.Filled.Home, Icons.Outlined.Home)
    data object Search : Tab(NavRoutes.Search, "Cerca", Icons.Filled.Search, Icons.Outlined.Search)
    data object Anime : Tab(NavRoutes.Anime, "Anime", Icons.Filled.Animation, Icons.Outlined.Animation)
    data object Watchlist : Tab(NavRoutes.Watchlist, "Lista", Icons.Filled.Bookmark, Icons.Outlined.Bookmark)
}

internal val tabs = listOf(Tab.Home, Tab.Search, Tab.Anime, Tab.Watchlist)

/**
 * Bottom bar in stile "glass": pillola flottante semitrasparente con bordo
 * sottile (token [GlassDefaults]). Ogni tab è un bottone a capsula; quello
 * selezionato si tinge di primary ed espande la label, gli altri restano icona
 * muta. Galleggia sopra l'[AmbientBackground] da cui prende l'effetto vetro.
 *
 * Condivisa fra telefono ([RootTabView]) e tablet in portrait
 * ([TabletRootView]): stesso look & feel, animazione pillola identica.
 * In landscape il tablet usa invece la NavigationRail.
 */
@Composable
internal fun GlassBottomBar(
    hazeState: HazeState,
    selectedRoute: (Tab) -> Boolean,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier
) {
    val accent = MaterialTheme.colorScheme.primary
    val density = LocalDensity.current
    val selectedIndex = tabs.indexOfFirst(selectedRoute).coerceAtLeast(0)
    // Posizione/larghezza misurati di ogni tab (relative al wrapper) per far
    // scorrere un'unica pillola-highlight verso il tab selezionato.
    val tabOffsets = remember { mutableStateListOf(*Array(tabs.size) { 0.dp }) }
    val tabWidths = remember { mutableStateListOf(*Array(tabs.size) { 0.dp }) }
    var tabHeight by remember { mutableStateOf(0.dp) }
    // Modalità prestazioni: niente molla, la pillola salta diretta alla posizione.
    val reduced = LocalReducedEffects.current
    val pillSpec = if (reduced) snap() else spring<Dp>(dampingRatio = 0.8f, stiffness = 400f)
    val pillOffset by animateDpAsState(
        targetValue = tabOffsets[selectedIndex],
        animationSpec = pillSpec,
        label = "pillOffset"
    )
    val pillWidth by animateDpAsState(
        targetValue = tabWidths[selectedIndex],
        animationSpec = pillSpec,
        label = "pillWidth"
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                WindowInsets.navigationBars.asPaddingValues()
            )
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier.glassCapsule(hazeState, GlassDefaults.ChipShape)
        ) {
            Box(modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp)) {
                // Pillola scorrevole dietro i tab: trasla e si ridimensiona verso
                // il tab attivo (le label hanno larghezze diverse).
                if (pillWidth > 0.dp && tabHeight > 0.dp) {
                    Box(
                        modifier = Modifier
                            .offset(x = pillOffset)
                            .width(pillWidth)
                            .height(tabHeight)
                            .clip(GlassDefaults.ChipShape)
                            .background(accent.copy(alpha = 0.22f))
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    tabs.forEachIndexed { i, tab ->
                        val selected = selectedRoute(tab)
                        val contentColor by animateColorAsState(
                            targetValue = if (selected) accent else Color.White.copy(alpha = 0.6f),
                            label = "tabContent"
                        )
                        Column(
                            modifier = Modifier
                                .onGloballyPositioned { coords ->
                                    tabOffsets[i] = with(density) { coords.positionInParent().x.toDp() }
                                    tabWidths[i] = with(density) { coords.size.width.toDp() }
                                    tabHeight = with(density) { coords.size.height.toDp() }
                                }
                                .clip(GlassDefaults.ChipShape)
                                .clickable { onSelect(tab) }
                                .padding(horizontal = 24.dp, vertical = 6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(
                                imageVector = if (selected) tab.selectedIcon else tab.unselectedIcon,
                                contentDescription = tab.title,
                                tint = contentColor,
                                modifier = Modifier.size(20.dp)
                            )
                            Text(
                                text = tab.title,
                                color = contentColor,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                                fontSize = 11.sp,
                                maxLines = 1
                            )
                        }
                    }
                }
            }
        }
    }
}
